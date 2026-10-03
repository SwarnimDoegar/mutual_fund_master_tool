//! End-to-end test of the SQL layer on synthetic funds whose metrics have closed-form answers.
//!
//! Needs a ClickHouse server: set MF_CLICKHOUSE_URL (./dev.sh test sets it). Uses (and drops)
//! the database `mf_test`. Skips when MF_CLICKHOUSE_URL is unset.

use std::path::PathBuf;

use anyhow::Result;
use chrono::{Datelike, Duration, NaiveDate, Weekday};
use clickhouse::Row;
use mf::config::Settings;
use mf::db::{Db, NavRow, SchemeRow};
use mf::{migrate, refresh};
use serde::Deserialize;

const RF: u32 = 9001; // liquid fund, publishes every calendar day, 6% a year
const PROXY: u32 = 9002; // index fund used as the Large Cap benchmark proxy
const HIGH_BETA: u32 = 9003; // excess return = 1.5 x proxy excess return, exactly
const STEADY: u32 = 9004; // 12% a year in calendar time, plus one glitch day
const STEADY_REG: u32 = 9005; // Regular plan of STEADY, 11% a year
const STEADY_IDCW: u32 = 9006; // IDCW option of STEADY, pays 5% on PAYOUT_DAY
const DRAWDOWN: u32 = 9007; // 100 -> 200 -> 100 -> 200 -> 260
const YOUNG: u32 = 9008; // launched 2025-01-01: too young for any 3Y statistic
const GAPPY: u32 = 9009; // no NAVs between 2024-06-28 and 2025-10-15

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

fn start() -> NaiveDate {
    d("2019-01-01")
}
fn end() -> NaiveDate {
    d("2026-09-30")
}
fn glitch_day() -> NaiveDate {
    d("2025-06-11")
}
fn payout_day() -> NaiveDate {
    d("2026-03-02")
}

fn days(from: NaiveDate, to: NaiveDate) -> Vec<NaiveDate> {
    let mut out = vec![];
    let mut x = from;
    while x <= to {
        out.push(x);
        x += Duration::days(1);
    }
    out
}

fn business_days() -> Vec<NaiveDate> {
    days(start(), end()).into_iter().filter(|x| !matches!(x.weekday(), Weekday::Sat | Weekday::Sun)).collect()
}

fn calendar_growth(base: f64, rate: f64, day: NaiveDate) -> f64 {
    base * (1.0 + rate).powf((day - start()).num_days() as f64 / 365.0)
}

fn rf_level(day: NaiveDate) -> f64 {
    calendar_growth(1000.0, 0.06, day)
}

/// Piecewise-linear interpolation through (date, value) knots.
fn piecewise(knots: &[(NaiveDate, f64)], day: NaiveDate) -> f64 {
    for w in knots.windows(2) {
        let ((d0, v0), (d1, v1)) = (w[0], w[1]);
        if day >= d0 && day <= d1 {
            let t = (day - d0).num_days() as f64 / (d1 - d0).num_days() as f64;
            return v0 + (v1 - v0) * t;
        }
    }
    knots.last().unwrap().1
}

fn synthetic_navs() -> Vec<NavRow> {
    let mut rows = vec![];
    let bdays = business_days();
    for day in days(start(), end()) {
        rows.push(NavRow { scheme_code: RF, date: day, nav: rf_level(day) });
    }
    // Deterministic, non-trivial index returns; high-beta fund built on the same rf intervals.
    let (mut p, mut h) = (100.0, 100.0);
    for (i, day) in bdays.iter().enumerate() {
        if i > 0 {
            let rp = 0.0004 + 0.012 * ((i as f64) * 0.7).sin() + 0.004 * ((i as f64) * 0.13).cos();
            let rf = rf_level(*day) / rf_level(bdays[i - 1]) - 1.0;
            p *= 1.0 + rp;
            h *= 1.0 + rf + 1.5 * (rp - rf);
        }
        rows.push(NavRow { scheme_code: PROXY, date: *day, nav: p });
        rows.push(NavRow { scheme_code: HIGH_BETA, date: *day, nav: h });
    }
    let mut idcw = 10.0;
    for (i, day) in bdays.iter().enumerate() {
        let steady = calendar_growth(10.0, 0.12, *day);
        let nav = if *day == glitch_day() { steady * 10.0 } else { steady };
        rows.push(NavRow { scheme_code: STEADY, date: *day, nav });
        rows.push(NavRow { scheme_code: STEADY_REG, date: *day, nav: calendar_growth(10.0, 0.11, *day) });
        if i > 0 {
            let r = steady / calendar_growth(10.0, 0.12, bdays[i - 1]) - 1.0;
            let prev = idcw;
            idcw = prev * (1.0 + r) - if *day == payout_day() { 0.05 * prev } else { 0.0 };
        }
        rows.push(NavRow { scheme_code: STEADY_IDCW, date: *day, nav: idcw });
        let knots = [
            (start(), 100.0),
            (d("2021-01-01"), 200.0),
            (d("2022-01-03"), 100.0),
            (d("2023-01-02"), 200.0),
            (end(), 260.0),
        ];
        rows.push(NavRow { scheme_code: DRAWDOWN, date: *day, nav: piecewise(&knots, *day) });
        if *day >= d("2025-01-01") {
            rows.push(NavRow { scheme_code: YOUNG, date: *day, nav: calendar_growth(10.0, 0.12, *day) });
        }
        if *day <= d("2024-06-28") || *day >= d("2025-10-15") {
            rows.push(NavRow { scheme_code: GAPPY, date: *day, nav: calendar_growth(10.0, 0.08, *day) });
        }
    }
    rows
}

fn scheme(code: u32, name: &str, category: &str) -> SchemeRow {
    SchemeRow {
        scheme_code: code,
        scheme_name: name.into(),
        fund_house: "Test Mutual Fund".into(),
        scheme_type: "Open Ended Schemes".into(),
        scheme_category: category.into(),
        isin_growth: None,
        isin_div_reinvestment: None,
    }
}

async fn setup() -> Result<Option<Db>> {
    let Ok(url) = std::env::var("MF_CLICKHOUSE_URL") else {
        eprintln!("MF_CLICKHOUSE_URL not set; skipping pipeline test");
        return Ok(None);
    };
    let settings = Settings {
        clickhouse_url: url,
        clickhouse_user: std::env::var("MF_CLICKHOUSE_USER").unwrap_or("mf".into()),
        clickhouse_password: std::env::var("MF_CLICKHOUSE_PASSWORD").unwrap_or("mf_local_password".into()),
        clickhouse_database: "mf_test".into(),
        api_base: String::new(),
        concurrency: 1,
        schedule: String::new(),
        timezone: "UTC".into(),
        config_dir: PathBuf::from("config"),
    };
    let db = Db::connect(&settings).await?;
    db.exec("DROP DATABASE IF EXISTS mf_test SYNC").await?;
    let db = Db::connect(&settings).await?;
    migrate::run(&db).await?;

    db.exec(
        "INSERT INTO settings VALUES ('risk_free_fallback_rate', 0.06), ('risk_free_proxy_scheme_code', 9001),
         ('sip_monthly_amount', 10000), ('active_within_days', 7), ('glitch_min_move', 0.2),
         ('glitch_max_reversal', 0.02), ('idcw_min_gap', 0.0025)",
    )
    .await?;
    db.exec(
        "INSERT INTO category_map VALUES ('Equity Scheme - Large Cap Fund', 'Equity', 'Large Cap Fund', 1),
         ('Debt Scheme - Liquid Fund', 'Debt', 'Liquid Fund', 1),
         ('Other Scheme - Index Funds', 'Other', 'Index Fund', 0)",
    )
    .await?;
    db.exec("INSERT INTO benchmark_proxy VALUES ('Large Cap Fund', 9002, 'Test Nifty 100')").await?;

    let lc = "Equity Scheme - Large Cap Fund";
    let schemes = vec![
        scheme(RF, "Test Liquid Fund - Direct Plan - Growth", "Debt Scheme - Liquid Fund"),
        scheme(PROXY, "Test Nifty 100 Index Fund - Direct Plan - Growth", "Other Scheme - Index Funds"),
        scheme(HIGH_BETA, "Test High Beta Large Cap Fund - Direct Plan - Growth", lc),
        scheme(STEADY, "Test Steady Large Cap Fund - Direct Plan - Growth", lc),
        scheme(STEADY_REG, "Test Steady Large Cap Fund - Regular Plan - Growth", lc),
        scheme(STEADY_IDCW, "Test Steady Large Cap Fund - Direct Plan - IDCW", lc),
        scheme(DRAWDOWN, "Test Drawdown Large Cap Fund - Direct Plan - Growth", lc),
        scheme(YOUNG, "Test Young Large Cap Fund - Direct Plan - Growth", lc),
        scheme(GAPPY, "Test Gappy Large Cap Fund - Regular Plan - Growth", lc),
    ];
    db.insert_all("schemes", &schemes).await?;
    db.insert_all("nav", &synthetic_navs()).await?;
    refresh::run(&db, &Default::default(), None).await?;
    Ok(Some(db))
}

#[derive(Row, Deserialize)]
struct F64Row {
    v: f64,
}

async fn scalar(db: &Db, sql: &str) -> Result<f64> {
    Ok(db.client.query(sql).fetch_one::<F64Row>().await?.v)
}

async fn text(db: &Db, sql: &str) -> Result<String> {
    Ok(db.client.query(sql).fetch_one::<String>().await?)
}

fn assert_close(actual: f64, expected: f64, tol: f64, what: &str) {
    assert!((actual - expected).abs() <= tol, "{what}: expected {expected}, got {actual}");
}

#[tokio::test]
async fn metrics_match_closed_form_answers() -> Result<()> {
    let Some(db) = setup().await? else { return Ok(()) };

    // Glitch day is detected and excluded, so the steady fund's daily returns stay tiny.
    let glitch = text(&db, "SELECT toString(date) FROM nav_glitches WHERE scheme_code = 9004").await?;
    assert_eq!(glitch, "2025-06-11");
    let max_ret = scalar(&db, "SELECT max(abs(ret)) AS v FROM nav_clean WHERE scheme_code = 9004").await?;
    assert!(max_ret < 0.01, "glitch leaked into nav_clean: {max_ret}");

    // Name parsing and peer eligibility.
    let parsed = text(
        &db,
        "SELECT arrayStringConcat(groupArray(concat(toString(scheme_code), ':', plan, '/', option, '/', toString(peer_eligible))), ',')
         FROM (SELECT * FROM scheme_info WHERE scheme_code IN (9004, 9005, 9006) ORDER BY scheme_code)",
    )
    .await?;
    assert_eq!(parsed, "9004:Direct/Growth/1,9005:Regular/Growth/1,9006:Direct/IDCW/0");

    // Siblings.
    let sib = text(
        &db,
        "SELECT arrayStringConcat(groupArray(concat(toString(scheme_code), relation, toString(sibling_code))), ',')
         FROM (SELECT * FROM scheme_siblings WHERE scheme_code IN (9004, 9005, 9006) ORDER BY scheme_code, relation)",
    )
    .await?;
    assert_eq!(sib, "9004regular9005,9005direct9004,9006growth9004");

    // 3Y CAGR: start NAV is the nearest on or before 2023-09-30 (a Saturday) -> 2023-09-29.
    let expected = (calendar_growth(10.0, 0.12, end()) / calendar_growth(10.0, 0.12, d("2023-09-29"))).powf(1.0 / 3.0) - 1.0;
    let cagr = scalar(&db, "SELECT assumeNotNull(cagr) AS v FROM fund_returns WHERE scheme_code = 9004 AND horizon = '3Y'").await?;
    assert_close(cagr, expected, 1e-12, "3Y CAGR");

    // SIP into an asset compounding at exactly 12% (ACT/365) has an XIRR of exactly 12%.
    let xirr = scalar(&db, "SELECT assumeNotNull(xirr) AS v FROM fund_sip WHERE scheme_code = 9004 AND tenure = '3Y'").await?;
    assert_close(xirr, 0.12, 1e-6, "SIP 3Y XIRR");
    let n = scalar(&db, "SELECT toFloat64(installments) AS v FROM fund_sip WHERE scheme_code = 9004 AND tenure = '3Y'").await?;
    assert_eq!(n, 36.0);

    // Excess return = 1.5 x benchmark excess return on every day -> beta 1.5, alpha 0, R^2 1.
    for (col, want, tol) in [("beta", 1.5, 1e-9), ("alpha", 0.0, 1e-9), ("r_squared", 1.0, 1e-9)] {
        let got = scalar(
            &db,
            &format!(
                "SELECT assumeNotNull({col}) AS v FROM fund_relative
                 WHERE scheme_code = 9003 AND basis = 'daily' AND period = '3Y' AND benchmark = 'index'"
            ),
        )
        .await?;
        assert_close(got, want, tol, col);
    }

    // Drawdown 200 -> 100 with exact peak, trough and recovery dates.
    let mdd = scalar(&db, "SELECT max_drawdown AS v FROM fund_risk WHERE scheme_code = 9007 AND basis = 'daily' AND period = 'SI'").await?;
    assert_close(mdd, -0.5, 1e-12, "max drawdown");
    let dates = text(
        &db,
        "SELECT concat(toString(mdd_peak_date), ' ', toString(mdd_trough_date), ' ', ifNull(toString(mdd_recovery_date), '-'))
         FROM fund_risk WHERE scheme_code = 9007 AND basis = 'daily' AND period = 'SI'",
    )
    .await?;
    assert_eq!(dates, "2021-01-01 2022-01-03 2023-01-02");
    let ep = text(&db, "SELECT concat(toString(peak_date), ' ', ifNull(toString(recovery_date), '-')) FROM fund_drawdowns WHERE scheme_code = 9007 AND rank = 1").await?;
    assert_eq!(ep, "2021-01-01 2023-01-02");

    // IDCW payout of 5% of the previous NAV on the payout day, nothing else.
    let payout = scalar(&db, "SELECT payout_pct AS v FROM idcw_events WHERE scheme_code = 9006 AND date = '2026-03-02'").await?;
    assert_close(payout, 0.05, 1e-9, "IDCW payout");
    let events = scalar(&db, "SELECT toFloat64(count()) AS v FROM idcw_events WHERE scheme_code = 9006").await?;
    assert_eq!(events, 1.0);

    // Risk-free proxy compounding at 6%: rf daily returns over a calendar year sum to ~6%.
    let rf = scalar(&db, "SELECT exp(sum(log1p(rf_ret))) - 1 AS v FROM fund_daily WHERE scheme_code = 9004 AND date > '2025-09-30'").await?;
    assert_close(rf, 0.06, 1e-9, "risk-free accrual");

    // Direct vs Regular: 12% vs 11% a year.
    let gap = scalar(&db, "SELECT assumeNotNull(direct_minus_regular_3y) AS v FROM fund_metrics WHERE scheme_code = 9004").await?;
    assert_close(gap, 0.01, 1e-3, "direct minus regular");

    // Ranks: three Direct Growth Large Cap peers; the 1.5-beta fund is the most volatile, and
    // volatility is ranked lower-is-better, so it comes last.
    let vol_rank = text(
        &db,
        "SELECT concat(toString(rank), '/', toString(peers)) FROM fund_ranks_latest
         WHERE metric = 'volatility_3y' AND scheme_code = 9003",
    )
    .await?;
    assert_eq!(vol_rank, "3/3");

    // Windows longer than the fund's history are omitted on every basis and table.
    let young = scalar(
        &db,
        "SELECT toFloat64(assumeNotNull(
                    (SELECT count() FROM fund_relative WHERE scheme_code = 9008 AND period != '1Y')
                  + (SELECT count() FROM fund_risk WHERE scheme_code = 9008 AND period IN ('3Y', '5Y', '10Y'))
                  + (SELECT count() FROM fund_returns WHERE scheme_code = 9008 AND horizon IN ('2Y', '3Y')))) AS v",
    )
    .await?;
    assert_eq!(young, 0.0, "young fund got multi-year statistics");

    // A window whose base NAV is stale (the data gap spans the window start) is omitted: the 1Y
    // window would start from a NAV 15 months old. 3Y/5Y start before the gap and are kept.
    let gappy = text(
        &db,
        "SELECT arrayStringConcat(groupArray(period), ',') FROM
         (SELECT period FROM fund_risk WHERE scheme_code = 9009 AND basis = 'daily' ORDER BY period)",
    )
    .await?;
    assert_eq!(gappy, "3Y,5Y,SI", "stale-start windows must be dropped");

    // Re-running the refresh for the same day does not duplicate rank history.
    let before = scalar(&db, "SELECT toFloat64(count()) AS v FROM fund_ranks FINAL").await?;
    refresh::run(&db, &refresh::RefreshArgs { only: vec!["fund_ranks".into()], ..Default::default() }, None).await?;
    let after = scalar(&db, "SELECT toFloat64(count()) AS v FROM fund_ranks FINAL").await?;
    assert_eq!(before, after);
    Ok(())
}
