//! End-to-end test of the SQL layer on synthetic funds whose metrics have closed-form answers.
//!
//! Needs a ClickHouse server: set MF_CLICKHOUSE_URL (./dev.sh test sets it). Uses (and drops)
//! the database `mf_test`. Skips when MF_CLICKHOUSE_URL is unset.

use std::path::PathBuf;

use anyhow::Result;
use clickhouse::Row;
use mf::config::Settings;
use mf::db::Db;
use mf::testing::{calendar_growth, d, end};
use mf::db::migrate;
use mf::orchestration::refresh;
use serde::Deserialize;

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
        run_on_start: false,
        config_dir: PathBuf::from("config"),
    };
    let db = Db::connect(&settings).await?;
    db.exec("DROP DATABASE IF EXISTS mf_test SYNC").await?;
    let db = Db::connect(&settings).await?;
    migrate::run(&db).await?;

    mf::testing::seed(&db).await?;
    mf::testing::seed_edge_cases(&db).await?;
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

    // A x100 face-value change is restated, not reported as a 9,900% gain.
    let factor = scalar(&db, "SELECT factor AS v FROM nav_adjustments WHERE scheme_code = 9010").await?;
    assert_eq!(factor, 100.0);
    let expected = (calendar_growth(10.0, 0.12, end()) / calendar_growth(10.0, 0.12, d("2023-09-29"))).powf(1.0 / 3.0) - 1.0;
    let cagr = scalar(&db, "SELECT assumeNotNull(cagr) AS v FROM fund_returns WHERE scheme_code = 9010 AND horizon = '3Y'").await?;
    assert_close(cagr, expected, 1e-12, "3Y CAGR across a unit change");
    let raw = scalar(&db, "SELECT raw_nav AS v FROM nav_clean WHERE scheme_code = 9010 AND date = '2023-01-02'").await?;
    assert_close(raw, calendar_growth(10.0, 0.12, d("2023-01-02")), 1e-9, "published NAV kept");

    // Skewness and excess kurtosis are Excel's SKEW and KURT (adjusted Fisher-Pearson, as
    // Morningstar uses): monthly returns [0 x 11, 0.12] give 2*sqrt(3) and exactly 12.
    let (skew, kurt) = (
        scalar(&db, "SELECT ifNull(skewness, nan) AS v FROM fund_risk WHERE scheme_code = 9011 AND basis = 'monthly' AND period = '1Y'").await?,
        scalar(&db, "SELECT ifNull(excess_kurtosis, nan) AS v FROM fund_risk WHERE scheme_code = 9011 AND basis = 'monthly' AND period = '1Y'").await?,
    );
    assert_close(skew, 12f64.sqrt(), 1e-9, "skewness");
    assert_close(kurt, 12.0, 1e-9, "excess kurtosis");

    // Gain/loss ratio with no gains at all is 0, not NaN.
    let gl = scalar(&db, "SELECT ifNull(gain_loss_ratio, nan) AS v FROM fund_risk WHERE scheme_code = 9012 AND basis = 'monthly' AND period = '1Y'").await?;
    assert_eq!(gl, 0.0, "gain/loss ratio without gains");

    // Category index: a fund that skips a day must not add its two-day move to one day's return.
    // Four funds go 100 -> 110 -> 121 and the fifth 100 -> (no NAV) -> 121: the index gains 21%.
    let [c1, _, c3] = mf::testing::catchup_days();
    let level = |cat: &str, day: chrono::NaiveDate| {
        format!("SELECT level AS v FROM category_index WHERE category = '{cat}' AND plan = 'Direct' AND date = '{day}'")
    };
    let growth = scalar(&db, &level("Mid Cap Fund", c3)).await? / scalar(&db, &level("Mid Cap Fund", c1)).await?;
    assert_close(growth, 1.21, 1e-10, "category index across a fund's missing day");
    // ... and a rejected thin day (3 of 10 funds) must not lose the move: 100 -> 110 for all ten.
    let [t0, t1, t2] = mf::testing::thin_days();
    let growth = scalar(&db, &level("Small Cap Fund", t2)).await? / scalar(&db, &level("Small Cap Fund", t0)).await?;
    assert_close(growth, 1.10, 1e-10, "category index across a rejected day");
    let thin = scalar(&db, &format!("SELECT toFloat64(count()) AS v FROM category_index WHERE category = 'Small Cap Fund' AND date = '{t1}'")).await?;
    assert_eq!(thin, 0.0, "thin day is not an index date");

    // Peer ranks follow Morningstar: distinct values are ranked i = 1..n, percentile rank =
    // floor(99 (i - 1) / (n - 1) + 1) (1 = best), quartile from it; `percentile` is that scale turned
    // round (100 = best). Every fund ranked first, tied or not, is Q1 at the 100th percentile.
    let firsts = text(
        &db,
        "SELECT concat(toString(min(quartile)), toString(max(quartile)), ' ', toString(min(percentile)), ' ', toString(count() > 0))
         FROM fund_ranks_latest WHERE rank = 1",
    )
    .await?;
    assert_eq!(firsts, "11 100 1", "every fund ranked first is Q1 at the 100th percentile");
    let worst = text(&db, "SELECT concat(toString(quartile), ' ', toString(percentile)) FROM fund_ranks_latest WHERE metric = 'volatility_3y' AND scheme_code = 9003").await?;
    assert_eq!(worst, "4 0");
    // STEADY and YOUNG compound at exactly 12%, so their 1Y returns tie: they share one rank and
    // one percentile, computed over the distinct values.
    let tie = text(
        &db,
        "SELECT arrayStringConcat(groupArray(concat(toString(rank), '/', toString(peers), ' ', toString(round(percentile, 6)))), ',')
         FROM (SELECT * FROM fund_ranks_latest WHERE metric = 'ret_1y' AND scheme_code IN (9004, 9008) ORDER BY scheme_code)",
    )
    .await?;
    let count_sql = |select: &str| {
        format!(
            "SELECT toFloat64({select}) AS v FROM fund_metrics
             WHERE category = 'Large Cap Fund' AND plan = 'Direct' AND peer_eligible AND ret_1y IS NOT NULL"
        )
    };
    let better = scalar(&db, &count_sql("countIf(ret_1y > (SELECT ret_1y FROM fund_metrics WHERE scheme_code = 9004))")).await?;
    let distinct_better = scalar(&db, &count_sql("uniqExactIf(ret_1y, ret_1y > (SELECT ret_1y FROM fund_metrics WHERE scheme_code = 9004))")).await?;
    let n_distinct = scalar(&db, &count_sql("uniqExact(ret_1y)")).await?;
    let peers = scalar(&db, &count_sql("count()")).await?;
    assert!(n_distinct < peers, "the tie reduces the number of distinct values");
    let i = distinct_better + 1.0;
    let pct_rank = if i == 1.0 { 1.0 } else { (99.0 * (i - 1.0) / (n_distinct - 1.0) + 1.0).floor() };
    let pct = format!("{}", ((100.0 - pct_rank) / 99.0 * 100.0 * 1e6).round() / 1e6);
    let rank = better as u32 + 1;
    assert_eq!(tie, format!("{rank}/{peers} {pct},{rank}/{peers} {pct}"), "tied funds share rank and percentile");

    // A complete period is not partial just because its last NAV came before month end: the
    // market's as-of date (2026-09-30) has passed September, as fund_monthly already treats it.
    let partial = text(
        &db,
        "SELECT arrayStringConcat(groupArray(concat(period_type, toString(is_partial))), ',') FROM
         (SELECT * FROM fund_period_returns WHERE scheme_code = 9014
          AND (period_type, period_start) IN (('month', '2026-09-01'), ('quarter', '2026-07-01'), ('year', '2026-01-01'))
          ORDER BY period_type)",
    )
    .await?;
    assert_eq!(partial, "month0,quarter0,year1");

    // Up percentage ratio counts only periods where the benchmark rose: this fund beats the flat
    // (forward-filled) weekend periods but never an up day.
    let up = scalar(&db, "SELECT ifNull(up_pct_ratio, nan) AS v FROM fund_relative WHERE scheme_code = 9013 AND basis = 'daily' AND period = '1Y' AND benchmark = 'index'").await?;
    assert_eq!(up, 0.0, "up percentage ratio");

    // A benchmark that stops publishing is carried forward 7 days, then it is missing, so no
    // benchmark-relative statistics are reported against it.
    let last = text(&db, "SELECT toString(max(date)) FROM benchmark_daily WHERE bench_key = 'proxy|9041'").await?;
    assert_eq!(last, "2026-07-07");
    // The same limit applies inside a gap (last NAV Fri 27 Feb, next on 23 Mar): 27 Feb + 7 days.
    let gap = text(
        &db,
        "SELECT concat(toString(max(date)), ' ', toString(count())) FROM benchmark_daily
         WHERE bench_key = 'proxy|9041' AND date BETWEEN '2026-02-27' AND '2026-03-22'",
    )
    .await?;
    assert_eq!(gap, "2026-03-06 8");
    let stale = scalar(&db, "SELECT toFloat64(count()) AS v FROM fund_relative WHERE scheme_code = 9021 AND benchmark = 'index' AND period = '1Y'").await?;
    assert_eq!(stale, 0.0, "relative stats against a stale benchmark");

    // Re-running the refresh for the same day does not duplicate rank history.
    let before = scalar(&db, "SELECT toFloat64(count()) AS v FROM fund_ranks FINAL").await?;
    refresh::run(&db, &refresh::RefreshArgs { only: vec!["fund_ranks".into()], ..Default::default() }, None).await?;
    let after = scalar(&db, "SELECT toFloat64(count()) AS v FROM fund_ranks FINAL").await?;
    assert_eq!(before, after);
    Ok(())
}
