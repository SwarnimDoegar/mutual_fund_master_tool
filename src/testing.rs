//! Synthetic funds with closed-form answers, shared by the pipeline and API test suites.
#![doc(hidden)]

use anyhow::Result;
use chrono::{Datelike, Duration, NaiveDate, Weekday};

use crate::db::{Db, NavRow, SchemeRow};

pub const RF: u32 = 9001; // liquid fund, publishes every calendar day, 6% a year
pub const PROXY: u32 = 9002; // index fund used as the Large Cap benchmark proxy
pub const HIGH_BETA: u32 = 9003; // excess return = 1.5 x proxy excess return, exactly
pub const STEADY: u32 = 9004; // 12% a year in calendar time, plus one glitch day
pub const STEADY_REG: u32 = 9005; // Regular plan of STEADY, 11% a year
pub const STEADY_IDCW: u32 = 9006; // IDCW option of STEADY, pays 5% on PAYOUT_DAY
pub const DRAWDOWN: u32 = 9007; // 100 -> 200 -> 100 -> 200 -> 260
pub const YOUNG: u32 = 9008; // launched 2025-01-01: too young for any 3Y statistic
pub const GAPPY: u32 = 9009; // no NAVs between 2024-06-28 and 2025-10-15
pub const REDENOM: u32 = 9010; // 12% a year; face value changes x100 on 2024-01-15

pub fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

pub fn start() -> NaiveDate {
    d("2019-01-01")
}
pub fn end() -> NaiveDate {
    d("2026-09-30")
}
pub fn glitch_day() -> NaiveDate {
    d("2025-06-11")
}
pub fn payout_day() -> NaiveDate {
    d("2026-03-02")
}

pub fn days(from: NaiveDate, to: NaiveDate) -> Vec<NaiveDate> {
    let mut out = vec![];
    let mut x = from;
    while x <= to {
        out.push(x);
        x += Duration::days(1);
    }
    out
}

pub fn business_days() -> Vec<NaiveDate> {
    days(start(), end()).into_iter().filter(|x| !matches!(x.weekday(), Weekday::Sat | Weekday::Sun)).collect()
}

pub fn calendar_growth(base: f64, rate: f64, day: NaiveDate) -> f64 {
    base * (1.0 + rate).powf((day - start()).num_days() as f64 / 365.0)
}

pub fn rf_level(day: NaiveDate) -> f64 {
    calendar_growth(1000.0, 0.06, day)
}

/// Piecewise-linear interpolation through (date, value) knots.
pub fn piecewise(knots: &[(NaiveDate, f64)], day: NaiveDate) -> f64 {
    for w in knots.windows(2) {
        let ((d0, v0), (d1, v1)) = (w[0], w[1]);
        if day >= d0 && day <= d1 {
            let t = (day - d0).num_days() as f64 / (d1 - d0).num_days() as f64;
            return v0 + (v1 - v0) * t;
        }
    }
    knots.last().unwrap().1
}

pub fn synthetic_navs() -> Vec<NavRow> {
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
        let unit = if *day >= d("2024-01-15") { 100.0 } else { 1.0 };
        rows.push(NavRow { scheme_code: REDENOM, date: *day, nav: unit * calendar_growth(10.0, 0.12, *day) });
        if *day <= d("2024-06-28") || *day >= d("2025-10-15") {
            rows.push(NavRow { scheme_code: GAPPY, date: *day, nav: calendar_growth(10.0, 0.08, *day) });
        }
    }
    rows
}

pub fn scheme(code: u32, name: &str, category: &str) -> SchemeRow {
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


/// Insert config rows, schemes and NAVs for the synthetic funds (migrations must have run).
pub async fn seed(db: &Db) -> Result<()> {
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
        scheme(REDENOM, "Test Redenominated Liquid Fund - Direct Plan - Growth", "Debt Scheme - Liquid Fund"),
    ];
    db.insert_all("schemes", &schemes).await?;
    db.insert_all("nav", &synthetic_navs()).await?;
    Ok(())
}
