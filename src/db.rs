use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, Utc};
use clickhouse::{Client, Row};
use serde::{Deserialize, Serialize};

use crate::config::Settings;

#[derive(Clone)]
pub struct Db {
    pub client: Client,
    pub database: String,
}

#[derive(Row, Serialize)]
pub struct SchemeRow {
    pub scheme_code: u32,
    pub scheme_name: String,
    pub fund_house: String,
    pub scheme_type: String,
    pub scheme_category: String,
    pub isin_growth: Option<String>,
    pub isin_div_reinvestment: Option<String>,
}

#[derive(Row, Serialize)]
pub struct NavRow {
    pub scheme_code: u32,
    #[serde(with = "clickhouse::serde::chrono::date")]
    pub date: NaiveDate,
    pub nav: f64,
}

#[derive(Row, Serialize)]
pub struct FetchStatusRow {
    pub scheme_code: u32,
    pub status: String,
    pub rows: u32,
    #[serde(with = "clickhouse::serde::chrono::date::option")]
    pub first_date: Option<NaiveDate>,
    #[serde(with = "clickhouse::serde::chrono::date::option")]
    pub last_date: Option<NaiveDate>,
    pub error: String,
}

#[derive(Row, Serialize)]
pub struct PipelineLogRow {
    #[serde(with = "clickhouse::serde::uuid")]
    pub run_id: uuid::Uuid,
    pub step: String,
    pub status: String,
    #[serde(with = "clickhouse::serde::chrono::datetime64::millis")]
    pub started_at: DateTime<Utc>,
    #[serde(with = "clickhouse::serde::chrono::datetime64::millis")]
    pub finished_at: DateTime<Utc>,
    pub details: String,
}

#[derive(Row, Deserialize)]
pub struct CodeDate {
    pub scheme_code: u32,
    #[serde(with = "clickhouse::serde::chrono::date")]
    pub date: NaiveDate,
}

impl Db {
    pub async fn connect(settings: &Settings) -> Result<Self> {
        let base = Client::default()
            .with_url(&settings.clickhouse_url)
            .with_user(&settings.clickhouse_user)
            .with_password(&settings.clickhouse_password)
            // LZ4 response compression turns server errors into "incorrect magic number";
            // the payloads here are small enough that plain HTTP costs nothing noticeable.
            .with_compression(clickhouse::Compression::None);
        let db = &settings.clickhouse_database;
        anyhow::ensure!(
            db.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
            "invalid database name {db:?}"
        );
        base.query(&format!("CREATE DATABASE IF NOT EXISTS `{db}`"))
            .execute()
            .await
            .with_context(|| format!("connecting to ClickHouse at {}", settings.clickhouse_url))?;
        Ok(Self { client: base.with_database(db), database: db.clone() })
    }

    /// Run raw SQL. The client treats `?` as a bind placeholder, so literal `?` is escaped.
    pub async fn exec(&self, sql: &str) -> Result<()> {
        self.client
            .query(&sql.replace('?', "??"))
            .execute()
            .await
            .with_context(|| format!("executing: {}", truncate(sql, 300)))
    }

    /// Insert rows in one short request. Callers buffer rows rather than streaming them through
    /// a long-lived INSERT: ClickHouse closes an HTTP request body that
    /// stays idle for 30 s, which happens while slow mfapi fetches are in flight.
    pub async fn insert_all<T>(&self, table: &str, rows: &[T]) -> Result<()>
    where
        T: Row + Serialize,
        for<'a> T: Row<Value<'a> = T>,
    {
        if rows.is_empty() {
            return Ok(());
        }
        let mut insert = self.client.insert::<T>(table).await?;
        for row in rows {
            insert.write(row).await?;
        }
        insert.end().await.with_context(|| format!("inserting {} rows into {table}", rows.len()))
    }

    pub async fn log_step(&self, row: PipelineLogRow) -> Result<()> {
        let mut insert = self.client.insert::<PipelineLogRow>("pipeline_log").await?;
        insert.write(&row).await?;
        insert.end().await?;
        Ok(())
    }
}

pub fn truncate(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}
