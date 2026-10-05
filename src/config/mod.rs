pub mod sync;

use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::Deserialize;

/// Runtime settings, all overridable through `MF_*` environment variables.
#[derive(clap::Args, Debug, Clone)]
pub struct Settings {
    #[arg(long, env = "MF_CLICKHOUSE_URL", default_value = "http://localhost:18123")]
    pub clickhouse_url: String,
    #[arg(long, env = "MF_CLICKHOUSE_USER", default_value = "mf")]
    pub clickhouse_user: String,
    #[arg(long, env = "MF_CLICKHOUSE_PASSWORD", default_value = "mf_local_password", hide_env_values = true)]
    pub clickhouse_password: String,
    #[arg(long, env = "MF_CLICKHOUSE_DATABASE", default_value = "mf")]
    pub clickhouse_database: String,
    #[arg(long, env = "MF_API_BASE", default_value = "https://api.mfapi.in")]
    pub api_base: String,
    /// Parallel history requests to mfapi.in.
    #[arg(long, env = "MF_CONCURRENCY", default_value_t = 8)]
    pub concurrency: usize,
    /// `;`-separated cron expressions (sec min hour day month weekday), evaluated in MF_TIMEZONE.
    #[arg(long, env = "MF_SCHEDULE", default_value = "0 0 */4 * * *")]
    pub schedule: String,
    #[arg(long, env = "MF_TIMEZONE", default_value = "Asia/Kolkata")]
    pub timezone: String,
    /// `run`: do a full sync (config, ingest, refresh) as soon as the scheduler starts, before
    /// waiting for the first MF_SCHEDULE slot. Incremental, so a restart costs a few minutes.
    #[arg(long, env = "MF_RUN_ON_START", default_value_t = true, action = clap::ArgAction::Set)]
    pub run_on_start: bool,
    #[arg(long, env = "MF_CONFIG_DIR", default_value = "config")]
    pub config_dir: PathBuf,
}

/// `config/settings.toml`: analytics conventions and benchmark proxies.
#[derive(Debug, Deserialize)]
pub struct AnalyticsConfig {
    pub analytics: Analytics,
    #[serde(default)]
    pub benchmark: Vec<BenchmarkProxy>,
}

#[derive(Debug, Deserialize)]
pub struct Analytics {
    pub risk_free_fallback_rate: f64,
    pub risk_free_proxy_scheme_code: u32,
    pub sip_monthly_amount: f64,
    pub active_within_days: u32,
    pub glitch_min_move: f64,
    pub glitch_max_reversal: f64,
    pub idcw_min_gap: f64,
}

#[derive(Debug, Deserialize)]
pub struct BenchmarkProxy {
    pub category: String,
    pub scheme_code: u32,
    pub index: String,
}

#[derive(Debug, Deserialize)]
pub struct CategoryMapping {
    pub raw_category: String,
    pub asset_class: String,
    pub category: String,
    pub rankable: u8,
}

impl Settings {
    pub fn load_analytics(&self) -> Result<AnalyticsConfig> {
        let path = self.config_dir.join("settings.toml");
        let text = std::fs::read_to_string(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        toml::from_str(&text).with_context(|| format!("parsing {}", path.display()))
    }

    pub fn load_categories(&self) -> Result<Vec<CategoryMapping>> {
        let path = self.config_dir.join("categories.csv");
        let mut reader = csv::Reader::from_path(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        reader
            .deserialize()
            .collect::<Result<Vec<CategoryMapping>, _>>()
            .with_context(|| format!("parsing {}", path.display()))
    }
}
