//! ClickHouse access. Queries return JSON rows exactly as ClickHouse renders them; every
//! user-supplied value travels as a typed server-side parameter (`{name:Type}`), never as SQL text.

use std::sync::Arc;
use std::time::Duration;

use clickhouse::Client;
use tokio::sync::Semaphore;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use crate::config::Config;
use crate::error::{ApiError, ApiResult};

pub type Row = Map<String, Value>;

#[derive(Clone)]
pub struct Db {
    client: Client,
    /// Bounds concurrent ClickHouse work: cache misses that pile up are shed with 503 instead of
    /// queueing unboundedly on the database.
    permits: Arc<Semaphore>,
}

/// A query plus its parameters, executed as JSONEachRow.
pub struct Query {
    inner: clickhouse::query::Query,
    permits: Arc<Semaphore>,
}

const PERMIT_WAIT: Duration = Duration::from_secs(2);

impl Db {
    pub fn new(cfg: &Config) -> Self {
        let client = Client::default()
            .with_url(&cfg.clickhouse_url)
            .with_user(&cfg.clickhouse_user)
            .with_password(&cfg.clickhouse_password)
            .with_database(&cfg.clickhouse_database)
            .with_compression(clickhouse::Compression::None)
            // JSON numbers for 64-bit integers and ISO-8601 timestamps
            .with_setting("output_format_json_quote_64bit_integers", "0")
            .with_setting("date_time_output_format", "iso");
        Self { client, permits: Arc::new(Semaphore::new(cfg.max_db_queries.max(1))) }
    }

    /// SQL must not contain `?` (the client's bind placeholder); use `{name:Type}` parameters.
    pub fn sql(&self, sql: &str) -> Query {
        debug_assert!(!sql.contains('?'), "use {{name:Type}} parameters, not ?");
        Query { inner: self.client.query(sql), permits: self.permits.clone() }
    }

    pub async fn ping(&self) -> ApiResult<()> {
        self.client.query("SELECT 1").execute().await?;
        Ok(())
    }
}

impl Query {
    pub fn param(mut self, name: &str, value: impl Serialize) -> Self {
        self.inner = self.inner.param(name, value);
        self
    }

    pub async fn rows(self) -> ApiResult<Vec<Row>> {
        let _permit = tokio::time::timeout(PERMIT_WAIT, self.permits.acquire())
            .await
            .map_err(|_| ApiError::Overloaded)?
            .map_err(|_| ApiError::Overloaded)?;
        let bytes = self.inner.fetch_bytes("JSONEachRow")?.collect().await?;
        bytes
            .split(|b| *b == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice(line).map_err(ApiError::from))
            .collect()
    }

    pub async fn one(self) -> ApiResult<Option<Row>> {
        Ok(self.rows().await?.into_iter().next())
    }

    /// Rows deserialized into a type (for internal queries).
    pub async fn typed<T: DeserializeOwned>(self) -> ApiResult<Vec<T>> {
        self.rows()
            .await?
            .into_iter()
            .map(|r| serde_json::from_value(Value::Object(r)).map_err(ApiError::from))
            .collect()
    }
}
