//! Recomputes the refreshable materialized views in dependency order.
//!
//! ClickHouse does not cascade a manual `SYSTEM REFRESH VIEW` to views that `DEPENDS ON` it, so
//! the order lives here. A stopped view silently ignores `SYSTEM REFRESH VIEW` while
//! `SYSTEM WAIT VIEW` still succeeds, so every step is verified via `last_success_time`.

use std::time::Instant;

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use clickhouse::Row;
use serde::Deserialize;
use tracing::info;

use crate::db::{Db, PipelineLogRow};

/// Every refreshable view (`<name>_mv` writing into table `<name>`), in dependency order.
pub const REFRESH_ORDER: &[&str] = &[
    "nav_glitches",
    "nav_clean",
    "scheme_info",
    "scheme_siblings",
    "category_index",
    "benchmark_daily",
    "fund_daily",
    "fund_monthly",
    "fund_returns",
    "fund_price_stats",
    "fund_period_returns",
    "fund_risk",
    "fund_drawdowns",
    "fund_relative",
    "fund_rolling",
    "fund_sip",
    "idcw_events",
    "data_quality",
    "fund_metrics",
    "fund_ranks",
    "category_stats",
    "fund_house_stats",
];

#[derive(clap::Args, Debug, Clone, Default)]
pub struct RefreshArgs {
    /// Start at this view and continue down the order (e.g. after fixing a failure).
    #[arg(long)]
    pub from: Option<String>,
    /// Refresh only these views (comma-separated), still in dependency order.
    #[arg(long, value_delimiter = ',')]
    pub only: Vec<String>,
}

#[derive(Row, Deserialize)]
struct ViewName {
    view: String,
}

#[derive(Row, Deserialize)]
struct RefreshState {
    status: String,
    #[serde(with = "clickhouse::serde::chrono::datetime::option")]
    last_success_time: Option<DateTime<Utc>>,
    exception: String,
}

pub async fn run(db: &Db, args: &RefreshArgs, run_id: Option<uuid::Uuid>) -> Result<()> {
    check_registry(db).await?;

    let mut views: Vec<&str> = REFRESH_ORDER.to_vec();
    if let Some(from) = &args.from {
        let pos = views
            .iter()
            .position(|v| v == from)
            .with_context(|| format!("unknown view {from}"))?;
        views.drain(..pos);
    }
    if !args.only.is_empty() {
        for o in &args.only {
            anyhow::ensure!(REFRESH_ORDER.contains(&o.as_str()), "unknown view {o}");
        }
        views.retain(|v| args.only.iter().any(|o| o == v));
    }

    for view in views {
        let started = Utc::now();
        let clock = Instant::now();
        let result = refresh_one(db, view).await;
        let elapsed = clock.elapsed();
        if let Some(run_id) = run_id {
            db.log_step(PipelineLogRow {
                run_id,
                step: format!("refresh:{view}"),
                status: if result.is_ok() { "ok" } else { "error" }.into(),
                started_at: started,
                finished_at: Utc::now(),
                details: result.as_ref().err().map(|e| format!("{e:#}")).unwrap_or_default(),
            })
            .await?;
        }
        result.with_context(|| format!("refreshing {view}"))?;
        info!(view, seconds = format!("{:.1}", elapsed.as_secs_f64()), "refreshed");
        // Return freed allocator memory to the OS before the next heavy view. ClickHouse's total
        // memory limit tracks RSS, so retained pages from one refresh can starve the next on
        // small hosts. Best effort: builds without jemalloc reject the command.
        let _ = db.exec("SYSTEM JEMALLOC PURGE").await;
    }
    Ok(())
}

async fn refresh_one(db: &Db, view: &str) -> Result<()> {
    let mv = format!("`{}`.`{view}_mv`", db.database);
    // Server clock, truncated to seconds like `last_success_time`.
    let before: u32 = db.client.query("SELECT toUnixTimestamp(now())").fetch_one().await?;
    db.exec(&format!("SYSTEM REFRESH VIEW {mv}")).await?;
    db.exec(&format!("SYSTEM WAIT VIEW {mv}")).await?;

    let state: RefreshState = db
        .client
        .query(
            "SELECT status, last_success_time, exception FROM system.view_refreshes
             WHERE database = currentDatabase() AND view = ?",
        )
        .bind(format!("{view}_mv"))
        .fetch_one()
        .await?;
    let fresh = state
        .last_success_time
        .is_some_and(|t| t.timestamp() >= i64::from(before));
    if !fresh {
        bail!(
            "view did not refresh (status {}, last success {:?}){}",
            state.status,
            state.last_success_time,
            if state.exception.is_empty() { String::new() } else { format!(": {}", state.exception) }
        );
    }
    Ok(())
}

/// Fail fast if a refreshable view exists that the order doesn't know about, or vice versa.
async fn check_registry(db: &Db) -> Result<()> {
    let present: Vec<String> = db
        .client
        .query("SELECT view FROM system.view_refreshes WHERE database = currentDatabase() ORDER BY view")
        .fetch_all::<ViewName>()
        .await?
        .into_iter()
        .map(|v| v.view)
        .collect();
    let expected: Vec<String> = REFRESH_ORDER.iter().map(|v| format!("{v}_mv")).collect();
    let unknown: Vec<_> = present.iter().filter(|v| !expected.contains(v)).collect();
    let missing: Vec<_> = expected.iter().filter(|v| !present.contains(v)).collect();
    if !unknown.is_empty() || !missing.is_empty() {
        bail!(
            "refreshable views out of sync with REFRESH_ORDER (run `mf migrate`?): \
             not in order list {unknown:?}, missing in database {missing:?}"
        );
    }
    Ok(())
}
