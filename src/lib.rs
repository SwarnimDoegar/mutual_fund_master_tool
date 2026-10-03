//! Mutual fund NAV pipeline: ingests mfapi.in into ClickHouse; metrics are ClickHouse
//! refreshable materialized views (see sql/migrations).

pub mod config;
pub mod db;
pub mod ingest;
pub mod mfapi;
pub mod migrate;
pub mod refresh;
pub mod scheduler;
pub mod sync_config;
pub mod util;
