use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde::Deserialize;

use crate::config::Config;
use crate::db::Db;
use crate::error::ApiResult;
use crate::store::ResponseStore;

/// Identifies the dataset currently served. It changes only when a metric refresh completes, which
/// invalidates cached responses and ETags. `as_of_date` is informational: tables are rebuilt one by
/// one during a refresh, so it can change before the refresh finishes (or one fails); keying the
/// cache on it would mint a cache generation for a half-rebuilt dataset.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct DataVersion {
    pub as_of_date: String,
    pub updated_at: String,
}

impl DataVersion {
    pub fn tag(&self) -> String {
        self.updated_at.clone()
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub cfg: Arc<Config>,
    pub store: ResponseStore,
    version: Arc<RwLock<DataVersion>>,
    /// fund_metrics column name -> ClickHouse type (screener whitelist).
    pub metric_columns: Arc<BTreeMap<String, String>>,
}

impl AppState {
    pub async fn new(cfg: Config) -> anyhow::Result<Self> {
        let db = Db::new(&cfg);
        let store = ResponseStore::new(&cfg.redis_url, cfg.cache_ttl)?;
        let metric_columns = load_columns(&db, "fund_metrics").await?;
        let state = Self {
            db,
            cfg: Arc::new(cfg),
            store,
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
            let new_generation = {
                let mut cur = self.version.write().unwrap();
                let changed = cur.tag() != v.tag();
                if changed || cur.as_of_date != v.as_of_date {
                    tracing::info!(as_of_date = %v.as_of_date, updated_at = %v.updated_at, "serving data version");
                    *cur = v.clone();
                }
                changed
            };
            if new_generation {
                // Responses of earlier versions can no longer be read; free their memory now.
                let store = self.store.clone();
                let tag = v.tag();
                tokio::spawn(async move {
                    let removed = store.purge_other_versions(&tag).await;
                    if removed > 0 {
                        tracing::info!(removed, "purged cached responses of earlier data versions");
                    }
                });
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

#[cfg(test)]
mod tests {
    use super::DataVersion;

    #[test]
    fn only_a_completed_refresh_changes_the_cache_generation() {
        let before = DataVersion { as_of_date: "2026-10-01".into(), updated_at: "2026-10-03 20:08:25.414".into() };
        // scheme_info rebuilt mid-refresh: as_of_date moves, the refresh has not finished
        let mid = DataVersion { as_of_date: "2026-10-02".into(), ..before.clone() };
        assert_eq!(before.tag(), mid.tag());
        let done = DataVersion { updated_at: "2026-10-04 20:05:00.000".into(), ..mid };
        assert_ne!(before.tag(), done.tag());
    }
}
