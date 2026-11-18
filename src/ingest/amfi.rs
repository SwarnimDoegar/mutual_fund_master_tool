//! AMFI's scheme master: one row per plan/option with its full name ("Scheme NAV Name").
//!
//! AMFI's daily NAV file (what mfapi serves) sometimes names a plan by the fund alone
//! ("Motilal Oswal Liquid Fund" for 20 plans) or gives two plans one name, which hides the plan,
//! the option and legacy share classes. The master names each one, so `scheme_info` reads it
//! where the daily name says nothing or is shared.

use std::collections::HashSet;
use std::time::Duration;

use anyhow::{Context, Result};
use clickhouse::Row;
use serde::Serialize;

use crate::db::Db;

/// Fewer rows than this means AMFI served an error page or a truncated file (the master lists
/// about 16,500 schemes).
const MIN_ROWS: usize = 5_000;

#[derive(Row, Serialize)]
struct MasterRow {
    scheme_code: u32,
    nav_name: String,
}

/// Download the master and store each scheme's plan name. Returns the number of rows written.
pub async fn sync(db: &Db, url: &str, codes: &[u32]) -> Result<usize> {
    let http = reqwest::Client::builder()
        .user_agent(concat!("mf-pipeline/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .build()?;
    let resp = http.get(url).send().await?.error_for_status()?;
    let body = resp.bytes().await.context("reading AMFI scheme master")?;
    let mut rows = parse(&body)?;
    anyhow::ensure!(rows.len() >= MIN_ROWS, "AMFI scheme master has only {} rows", rows.len());
    if !codes.is_empty() {
        let wanted: HashSet<u32> = codes.iter().copied().collect();
        rows.retain(|r| wanted.contains(&r.scheme_code));
    }
    db.insert_all("scheme_master", &rows).await?;
    Ok(rows.len())
}

/// Columns are found by header name ("Code", "Scheme NAV Name"); AMFI has reordered them before.
/// Text that is not valid UTF-8 is read lossily: only the plan words matter.
fn parse(body: &[u8]) -> Result<Vec<MasterRow>> {
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(body);
    let headers = reader.byte_headers()?.clone();
    let col = |name: &str| {
        headers
            .iter()
            .position(|h| String::from_utf8_lossy(h).trim().eq_ignore_ascii_case(name))
            .with_context(|| format!("AMFI scheme master has no {name:?} column"))
    };
    let (code_col, name_col) = (col("Code")?, col("Scheme NAV Name")?);
    let mut rows = Vec::new();
    for record in reader.byte_records() {
        let record = record?;
        let code = record.get(code_col).and_then(|c| std::str::from_utf8(c).ok()?.trim().parse().ok());
        let name = record.get(name_col).map(|n| String::from_utf8_lossy(n).split_whitespace().collect::<Vec<_>>().join(" "));
        if let (Some(scheme_code), Some(nav_name)) = (code, name.filter(|n| !n.is_empty())) {
            rows.push(MasterRow { scheme_code, nav_name });
        }
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_code_and_plan_name_by_header() {
        let csv = "AMC,Code,Scheme Name,Scheme Type,Scheme Category,Scheme NAV Name,Scheme Minimum Amount,Launch Date, Closure Date,ISIN Div Payout/ ISIN GrowthISIN Div Reinvestment\n\
                   Motilal Oswal AMC,146218,Motilal Oswal Liquid Fund,Open Ended,Debt Scheme - Liquid Fund,Motilal Oswal Liquid Fund Direct - IDCW  Quarterly Payout/Reinvestment,500,11-Dec-2018,18-Dec-2018,INF247L01791INF247L01783\n\
                   Broken AMC,not-a-code,X,Open Ended,Y,Z,1,,,\n\
                   Short AMC,152351\n";
        let rows = parse(csv.as_bytes()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].scheme_code, 146218);
        assert_eq!(rows[0].nav_name, "Motilal Oswal Liquid Fund Direct - IDCW Quarterly Payout/Reinvestment");
    }
}
