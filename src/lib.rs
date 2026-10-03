//! Mutual fund NAV pipeline: ingests mfapi.in into ClickHouse, then rebuilds the metric tables
//! with plain SQL (`sql/derived/`, run in order by `orchestration::refresh`).
//!
//! * `config`        settings, and loading config files into ClickHouse
//! * `db`            ClickHouse client and schema migrations (stored tables only)
//! * `ingest`        mfapi.in client and NAV ingestion
//! * `orchestration` metric refresh and the daily scheduler

pub mod config;
pub mod db;
pub mod ingest;
pub mod orchestration;
pub mod testing;
