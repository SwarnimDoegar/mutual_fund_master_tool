//! NAV ingestion.
//!
//! 1. Pull `/mf/latest` (one request) and upsert every scheme's metadata and newest NAV.
//! 2. Fetch full history for schemes we have never fetched successfully (first run = backfill).
//! 3. Re-fetch a date range for schemes whose newest stored NAV is more than one trading day
//!    behind the snapshot (see `util::has_weekday_between`).
//!
//! `nav` is a ReplacingMergeTree keyed on (scheme_code, date), so re-ingesting is idempotent and
//! a corrected NAV for an existing date replaces the old value.

pub mod mfapi;
pub mod parse;

use std::collections::{HashMap, HashSet};
use anyhow::Result;
use chrono::{Duration as ChronoDuration, NaiveDate};
use futures::{StreamExt, stream};
use serde::Serialize;
use tracing::{info, warn};

use crate::config::Settings;
use crate::db::{CodeDate, Db, FetchStatusRow, NavRow, SchemeRow};
use self::mfapi::{LatestItem, MfApi};
use self::parse::{has_weekday_between, parse_api_date, parse_nav};

#[derive(clap::Args, Debug, Clone, Default)]
pub struct IngestArgs {
    /// Only these scheme codes (comma-separated); useful for testing.
    #[arg(long, value_delimiter = ',')]
    pub codes: Vec<u32>,
    /// Re-fetch full history for every selected scheme, even if fetched before.
    #[arg(long)]
    pub full: bool,
    /// Skip the history phase (snapshot only).
    #[arg(long)]
    pub snapshot_only: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct IngestStats {
    pub schemes_in_snapshot: usize,
    pub snapshot_navs: usize,
    pub snapshot_invalid_navs: usize,
    pub history_full_fetches: usize,
    pub history_range_fetches: usize,
    pub history_rows: usize,
    pub history_invalid_rows: usize,
    pub history_empty: usize,
    pub history_errors: usize,
}

enum Plan {
    Full(u32),
    Range(u32, NaiveDate, NaiveDate),
}

struct Fetched {
    plan: Plan,
    result: Result<Vec<NavRow>>,
    invalid: usize,
}

pub async fn run(
    db: &Db,
    settings: &Settings,
    args: &IngestArgs,
) -> Result<IngestStats> {
    let api = MfApi::new(&settings.api_base)?;
    let mut stats = IngestStats::default();

    info!("fetching /mf/latest snapshot");
    let mut latest = api.latest().await?;
    if !args.codes.is_empty() {
        let wanted: HashSet<u32> = args.codes.iter().copied().collect();
        latest.retain(|i| wanted.contains(&i.scheme_code));
    }
    stats.schemes_in_snapshot = latest.len();
    anyhow::ensure!(!latest.is_empty(), "snapshot returned no schemes");

    // State before this run: newest stored NAV per scheme, and which histories are complete.
    let stored: HashMap<u32, NaiveDate> = db
        .client
        .query("SELECT scheme_code, max(last_date) AS date FROM scheme_nav_bounds GROUP BY scheme_code")
        .fetch_all::<CodeDate>()
        .await?
        .into_iter()
        .map(|r| (r.scheme_code, r.date))
        .collect();
    let fetched: HashSet<u32> = db
        .client
        .query("SELECT scheme_code FROM fetch_status FINAL WHERE status IN ('ok', 'empty')")
        .fetch_all::<u32>()
        .await?
        .into_iter()
        .collect();

    write_snapshot(db, &latest, &mut stats).await?;

    if !args.snapshot_only {
        let plans = plan_fetches(&latest, &stored, &fetched, args.full);
        stats.history_full_fetches = plans.iter().filter(|p| matches!(p, Plan::Full(_))).count();
        stats.history_range_fetches = plans.len() - stats.history_full_fetches;
        info!(
            full = stats.history_full_fetches,
            range = stats.history_range_fetches,
            concurrency = settings.concurrency,
            "fetching NAV history"
        );
        fetch_histories(db, &api, plans, settings.concurrency, &mut stats).await?;
    }

    if stats.history_errors > 0 {
        warn!(errors = stats.history_errors, "some histories failed; they are retried next run");
    }
    Ok(stats)
}

async fn write_snapshot(db: &Db, latest: &[LatestItem], stats: &mut IngestStats) -> Result<()> {
    let mut schemes = db.client.insert::<SchemeRow>("schemes").await?;
    let mut navs = db.client.insert::<NavRow>("nav").await?;
    for item in latest {
        schemes
            .write(&SchemeRow {
                scheme_code: item.scheme_code,
                scheme_name: item.scheme_name.clone().unwrap_or_default(),
                fund_house: item.fund_house.clone().unwrap_or_default(),
                scheme_type: item.scheme_type.clone().unwrap_or_default(),
                scheme_category: item.scheme_category.clone().unwrap_or_default(),
                isin_growth: item.isin_growth.clone().filter(|s| !s.is_empty()),
                isin_div_reinvestment: item.isin_div_reinvestment.clone().filter(|s| !s.is_empty()),
            })
            .await?;
        let date = item.date.as_deref().and_then(parse_api_date);
        let nav = item.nav.as_deref().and_then(parse_nav);
        match (date, nav) {
            (Some(date), Some(nav)) => {
                navs.write(&NavRow { scheme_code: item.scheme_code, date, nav }).await?;
                stats.snapshot_navs += 1;
            }
            _ => stats.snapshot_invalid_navs += 1,
        }
    }
    schemes.end().await?;
    navs.end().await?;
    info!(schemes = latest.len(), navs = stats.snapshot_navs, "snapshot written");
    Ok(())
}

fn plan_fetches(
    latest: &[LatestItem],
    stored: &HashMap<u32, NaiveDate>,
    fetched: &HashSet<u32>,
    full: bool,
) -> Vec<Plan> {
    // Gap repair only makes sense for schemes that are still publishing: closed schemes often
    // end with an invalid snapshot NAV (e.g. "0.00000") dated after their last valid one.
    let newest = latest
        .iter()
        .filter(|i| i.nav.as_deref().and_then(parse_nav).is_some())
        .filter_map(|i| i.date.as_deref().and_then(parse_api_date))
        .max();
    let recent_cutoff = newest.map(|d| d - ChronoDuration::days(60));

    let mut plans = Vec::new();
    for item in latest {
        let code = item.scheme_code;
        if full || !fetched.contains(&code) {
            plans.push(Plan::Full(code));
            continue;
        }
        let snapshot_ok = item.nav.as_deref().and_then(parse_nav).is_some();
        let snapshot_date = item.date.as_deref().and_then(parse_api_date);
        if let (true, Some(&have), Some(snap), Some(cutoff)) =
            (snapshot_ok, stored.get(&code), snapshot_date, recent_cutoff)
        {
            if snap >= cutoff && has_weekday_between(have, snap) {
                plans.push(Plan::Range(code, have + ChronoDuration::days(1), snap));
            }
        }
    }
    plans
}

async fn fetch_histories(
    db: &Db,
    api: &MfApi,
    plans: Vec<Plan>,
    concurrency: usize,
    stats: &mut IngestStats,
) -> Result<()> {
    let total = plans.len();
    if total == 0 {
        return Ok(());
    }
    // Rows are buffered and written in large batches so ClickHouse sees few, big parts.
    // Statuses are only written together with (after) the NAVs they describe, so a crash
    // never marks unsaved history as fetched.
    const FLUSH_ROWS: usize = 500_000;
    let mut navs: Vec<NavRow> = Vec::with_capacity(FLUSH_ROWS);
    let mut statuses: Vec<FetchStatusRow> = Vec::new();

    let mut results = stream::iter(plans)
        .map(|plan| {
            let api = api.clone();
            async move {
                let (code, range) = match plan {
                    Plan::Full(c) => (c, None),
                    Plan::Range(c, s, e) => (c, Some((s, e))),
                };
                let mut invalid = 0;
                let result = api.history(code, range).await.map(|h| {
                    h.data
                        .into_iter()
                        .filter_map(|p| {
                            let row = parse_api_date(&p.date)
                                .zip(parse_nav(&p.nav))
                                .map(|(date, nav)| NavRow { scheme_code: code, date, nav });
                            if row.is_none() {
                                invalid += 1;
                            }
                            row
                        })
                        .collect::<Vec<_>>()
                });
                Fetched { plan, result, invalid }
            }
        })
        .buffer_unordered(concurrency.max(1));

    let mut done = 0usize;
    while let Some(f) = results.next().await {
        done += 1;
        stats.history_invalid_rows += f.invalid;
        let (code, is_full) = match f.plan {
            Plan::Full(c) => (c, true),
            Plan::Range(c, ..) => (c, false),
        };
        match f.result {
            Ok(rows) => {
                let n = rows.len();
                stats.history_rows += n;
                if n == 0 {
                    stats.history_empty += 1;
                }
                if is_full {
                    statuses.push(FetchStatusRow {
                        scheme_code: code,
                        status: if n == 0 { "empty" } else { "ok" }.into(),
                        rows: n as u32,
                        first_date: rows.iter().map(|r| r.date).min(),
                        last_date: rows.iter().map(|r| r.date).max(),
                        error: String::new(),
                    });
                }
                navs.extend(rows);
            }
            Err(e) => {
                stats.history_errors += 1;
                warn!(scheme_code = code, error = %format!("{e:#}"), "history fetch failed");
                if is_full {
                    statuses.push(FetchStatusRow {
                        scheme_code: code,
                        status: "error".into(),
                        rows: 0,
                        first_date: None,
                        last_date: None,
                        error: format!("{e:#}"),
                    });
                }
            }
        }
        if navs.len() >= FLUSH_ROWS {
            db.insert_all("nav", &navs).await?;
            navs.clear();
            db.insert_all("fetch_status", &statuses).await?;
            statuses.clear();
        }
        if done % 500 == 0 || done == total {
            info!(done, total, rows = stats.history_rows, errors = stats.history_errors, "history progress");
        }
    }
    db.insert_all("nav", &navs).await?;
    db.insert_all("fetch_status", &statuses).await?;
    Ok(())
}
