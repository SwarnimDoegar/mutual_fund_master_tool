use anyhow::Result;
use clap::{Parser, Subcommand};
use mf::config::Settings;
use mf::db::Db;
use mf::{ingest, migrate, refresh, scheduler, sync_config};
use tracing::info;

#[derive(Parser)]
#[command(name = "mf", about = "Mutual fund NAV pipeline: mfapi.in -> ClickHouse")]
struct Cli {
    #[command(flatten)]
    settings: Settings,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Apply pending SQL migrations.
    Migrate,
    /// Load config/settings.toml and config/categories.csv into ClickHouse.
    SyncConfig,
    /// Fetch NAVs (latest snapshot + any missing history) without recomputing metrics.
    Ingest(ingest::IngestArgs),
    /// Recompute metric views in dependency order.
    Refresh(refresh::RefreshArgs),
    /// migrate + sync-config + ingest + refresh: the full daily pipeline.
    Daily(ingest::IngestArgs),
    /// Long-running scheduler: runs `daily` on MF_SCHEDULE (and immediately if never run).
    Run,
    /// Print recent pipeline runs and view refresh status.
    Status,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .with_target(false)
        .init();

    let cli = Cli::parse();
    let settings = cli.settings;
    let db = Db::connect(&settings).await?;

    match cli.command {
        Command::Migrate => migrate::run(&db).await?,
        Command::SyncConfig => sync_config::run(&db, &settings).await?,
        Command::Ingest(args) => {
            let stats = ingest::run(&db, &settings, &args).await?;
            info!(?stats, "ingest finished");
        }
        Command::Refresh(args) => refresh::run(&db, &args, None).await?,
        Command::Daily(args) => scheduler::daily(&db, &settings, &args).await?,
        Command::Run => scheduler::run_forever(&db, &settings).await?,
        Command::Status => scheduler::print_status(&db).await?,
    }
    Ok(())
}
