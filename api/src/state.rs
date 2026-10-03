use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use bytes::Bytes;
use moka::future::Cache;
use serde::Deserialize;

use crate::config::Config;
use crate::db::Db;
use crate::error::ApiResult;

/// Identifies the dataset currently served. It changes when a pipeline run completes, which
/// invalidates cached responses and ETags.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct DataVersion {
    pub as_of_date: String,
    pub updated_at: String,
}

impl DataVersion {
    pub fn tag(&self) -> String {
        format!("{}|{}", self.as_of_date, self.updated_at)
    }
}

#[derive(Clone)]
pub struct CachedResponse {
    pub content_type: String,
    pub body: Bytes,
}

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub cfg: Arc<Config>,
    pub cache: Cache<String, CachedResponse>,
    version: Arc<RwLock<DataVersion>>,
    /// fund_metrics column name -> ClickHouse type (screener whitelist).
    pub metric_columns: Arc<BTreeMap<String, String>>,
}

impl AppState {
    pub async fn new(cfg: Config) -> anyhow::Result<Self> {
        let db = Db::new(&cfg);
        let cache = Cache::builder()
            .weigher(|k: &String, v: &CachedResponse| (k.len() + v.body.len()).try_into().unwrap_or(u32::MAX))
            .max_capacity(cfg.cache_mb * 1024 * 1024)
            .time_to_live(Duration::from_secs(6 * 3600))
            .build();
        let metric_columns = load_columns(&db, "fund_metrics").await?;
        let state = Self {
            db,
            cfg: Arc::new(cfg),
            cache,
            version: Arc::new(RwLock::new(DataVersion::default())),
            metric_columns: Arc::new(metric_columns),
        };
        state.refresh_version().await?;
        Ok(state)
    }

    pub fn version(&self) -> DataVersion {
        self.version.read().unwrap().clone()
    }

    pub async fn refresh_version(&self) -> ApiResult<()> {
        let v: Vec<DataVersion> = self
            .db
            .sql(
                "SELECT
                    toString((SELECT any(as_of_date) FROM scheme_info)) AS as_of_date,
                    -- every completed metric refresh (scheduled or manual) logs step 'refresh'
                    toString(ifNull((SELECT max(finished_at) FROM pipeline_log
                                     WHERE step = 'refresh' AND status = 'ok'), toDateTime64(0, 3))) AS updated_at",
            )
            .typed()
            .await?;
        if let Some(v) = v.into_iter().next() {
            let mut cur = self.version.write().unwrap();
            if cur.tag() != v.tag() {
                tracing::info!(as_of_date = %v.as_of_date, updated_at = %v.updated_at, "serving data version");
                *cur = v;
            }
        }
        Ok(())
    }

    /// Poll for new pipeline runs; a new version makes old cache entries unreachable.
    pub fn spawn_version_watcher(&self) {
        let state = self.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(60));
            loop {
                tick.tick().await;
                if let Err(e) = state.refresh_version().await {
                    tracing::warn!(error = %e, "could not refresh data version");
                }
            }
        });
    }
}

async fn load_columns(db: &Db, table: &str) -> anyhow::Result<BTreeMap<String, String>> {
    #[derive(Deserialize)]
    struct Col {
        name: String,
        r#type: String,
    }
    let cols: Vec<Col> = db
        .sql("SELECT name, type FROM system.columns WHERE database = currentDatabase() AND table = {t:String}")
        .param("t", table)
        .typed()
        .await
        .map_err(|e| anyhow::anyhow!("loading columns of {table}: {e}"))?;
    anyhow::ensure!(!cols.is_empty(), "table {table} not found; has the pipeline run?");
    Ok(cols.into_iter().map(|c| (c.name, c.r#type)).collect())
}
