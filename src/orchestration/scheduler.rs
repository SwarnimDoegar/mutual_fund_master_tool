use std::str::FromStr;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use clickhouse::Row;
use cron::Schedule;
use serde::Deserialize;
use tracing::{error, info};

use crate::config::Settings;
use crate::db::{Db, PipelineLogRow};
use crate::config::sync as sync_config;
use crate::db::migrate;
use crate::ingest::{self, IngestArgs};
use crate::orchestration::refresh::{self, RefreshArgs};

/// The full pipeline: migrations, config, ingest, metric refresh. Each step is logged to
/// `pipeline_log` under one run id.
pub async fn daily(db: &Db, settings: &Settings, args: &IngestArgs) -> Result<()> {
    migrate::run(db).await?;
    let run_id = uuid::Uuid::new_v4();
    info!(%run_id, "pipeline run started");
    let started = Utc::now();

    let result: Result<()> = async {
        sync_config::run(db, settings).await?;

        let t = Utc::now();
        let stats = ingest::run(db, settings, args).await;
        db.log_step(PipelineLogRow {
            run_id,
            step: "ingest".into(),
            status: if stats.is_ok() { "ok" } else { "error" }.into(),
            started_at: t,
            finished_at: Utc::now(),
            details: match &stats {
                Ok(s) => serde_json::to_string(s)?,
                Err(e) => format!("{e:#}"),
            },
        })
        .await?;
        let stats = stats?;
        info!(?stats, "ingest finished");

        refresh::run(db, &RefreshArgs::default(), Some(run_id)).await
    }
    .await;

    db.log_step(PipelineLogRow {
        run_id,
        step: "pipeline".into(),
        status: if result.is_ok() { "ok" } else { "error" }.into(),
        started_at: started,
        finished_at: Utc::now(),
        details: result.as_ref().err().map(|e| format!("{e:#}")).unwrap_or_default(),
    })
    .await?;
    match &result {
        Ok(()) => info!(%run_id, "pipeline run finished"),
        Err(e) => error!(%run_id, error = %format!("{e:#}"), "pipeline run failed"),
    }
    result
}

pub async fn run_forever(db: &Db, settings: &Settings) -> Result<()> {
    let tz: Tz = settings
        .timezone
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid MF_TIMEZONE {}: {e}", settings.timezone))?;
    let schedules: Vec<Schedule> = settings
        .schedule
        .split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| Schedule::from_str(s).with_context(|| format!("invalid cron expression {s:?}")))
        .collect::<Result<_>>()?;
    anyhow::ensure!(!schedules.is_empty(), "MF_SCHEDULE is empty");

    migrate::run(db).await?;
    if !has_successful_run(db).await? {
        info!("no successful pipeline run yet; starting initial backfill now");
        let _ = daily(db, settings, &IngestArgs::default()).await;
    }

    loop {
        let now = Utc::now().with_timezone(&tz);
        let next = schedules
            .iter()
            .filter_map(|s| s.after(&now).next())
            .min()
            .context("schedule produced no future times")?;
        info!(next = %next, "sleeping until next scheduled run");
        let wait = (next.with_timezone(&Utc) - Utc::now()).to_std().unwrap_or_default();
        tokio::time::sleep(wait).await;
        // Failures are logged in pipeline_log; the next slot (or the morning retry) tries again.
        let _ = daily(db, settings, &IngestArgs::default()).await;
    }
}

async fn has_successful_run(db: &Db) -> Result<bool> {
    let n: u64 = db
        .client
        .query("SELECT count() FROM pipeline_log WHERE step = 'pipeline' AND status = 'ok'")
        .fetch_one()
        .await?;
    Ok(n > 0)
}

#[derive(Row, Deserialize)]
struct RunRow {
    run_id: String,
    status: String,
    #[serde(with = "clickhouse::serde::chrono::datetime64::millis")]
    started_at: DateTime<Utc>,
    seconds: f64,
    details: String,
}

#[derive(Row, Deserialize)]
struct StepRow {
    step: String,
    status: String,
    #[serde(with = "clickhouse::serde::chrono::datetime64::millis")]
    started_at: DateTime<Utc>,
    seconds: f64,
}

pub async fn print_status(db: &Db) -> Result<()> {
    let runs: Vec<RunRow> = db
        .client
        .query(
            "SELECT toString(run_id) AS run_id, status, started_at,
                    dateDiff('millisecond', started_at, finished_at) / 1000 AS seconds,
                    substring(details, 1, 200) AS details
             FROM pipeline_log WHERE step = 'pipeline' ORDER BY started_at DESC LIMIT 10",
        )
        .fetch_all()
        .await?;
    println!("Recent pipeline runs:");
    for r in runs {
        println!(
            "  {} {} {:>7.1}s {} {}",
            r.started_at.format("%Y-%m-%d %H:%M:%S"),
            r.status,
            r.seconds,
            r.run_id,
            r.details
        );
    }
    // The latest run of every refresh step, in execution order.
    let steps: Vec<StepRow> = db
        .client
        .query(
            "SELECT substring(step, 9) AS step, argMax(status, started_at) AS status,
                    max(started_at) AS started_at,
                    argMax(dateDiff('millisecond', started_at, finished_at), started_at) / 1000 AS seconds
             FROM pipeline_log WHERE startsWith(step, 'refresh:') GROUP BY step ORDER BY started_at",
        )
        .fetch_all()
        .await?;
    println!("\nRefresh steps (latest run):");
    for s in steps {
        println!(
            "  {:<22} {:<6} {} {:>7.1}s",
            s.step,
            s.status,
            s.started_at.format("%Y-%m-%d %H:%M:%S"),
            s.seconds
        );
    }
    Ok(())
}
