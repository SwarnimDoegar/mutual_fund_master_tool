//! Mutual fund NAV pipeline: ingests mfapi.in into ClickHouse; metrics are ClickHouse
//! refreshable materialized views (see sql/migrations).
//!
//! * `config`        settings, and loading config files into ClickHouse
//! * `db`            ClickHouse client and schema migrations
//! * `ingest`        mfapi.in client and NAV ingestion
//! * `orchestration` metric refresh in dependency order and the daily scheduler

pub mod config;
pub mod db;
pub mod ingest;
pub mod orchestration;
pub mod testing;
