-- Stored state: what the ingester writes, the config tables, and rank history. These are the only
-- tables that hold data that cannot be recomputed, so they are the only ones under versioned
-- migrations. Every metric table and view is rebuilt from them by `mf refresh` (sql/derived/).

-- Scheme metadata from /mf/latest. Re-ingesting replaces the row (latest updated_at wins).
CREATE TABLE IF NOT EXISTS schemes
(
    scheme_code           UInt32,
    scheme_name           String,
    fund_house            LowCardinality(String),
    scheme_type           LowCardinality(String),
    scheme_category       LowCardinality(String),
    isin_growth           Nullable(String),
    isin_div_reinvestment Nullable(String),
    updated_at            DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY scheme_code;

-- One NAV per scheme per date. A later ingest of the same (scheme_code, date) supersedes the
-- earlier one, so corrections published by AMCs flow through. Readers use `FROM nav FINAL`.
CREATE TABLE IF NOT EXISTS nav
(
    scheme_code UInt32,
    date        Date,
    nav         Float64,
    ingested_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (scheme_code, date);

-- Newest/oldest NAV date per scheme, maintained by an insert-triggered materialized view on every
-- insert into `nav` (incremental, so it costs nothing at refresh time). Only duplicate-safe
-- aggregates (min/max/argMax) are used, since `nav` may hold duplicates until merges run. The
-- ingester reads this to detect missed trading days.
CREATE TABLE IF NOT EXISTS scheme_nav_bounds
(
    scheme_code UInt32,
    first_date  SimpleAggregateFunction(min, Date),
    last_date   SimpleAggregateFunction(max, Date),
    last_nav    AggregateFunction(argMax, Float64, Tuple(Date, DateTime64(3)))
)
ENGINE = AggregatingMergeTree
ORDER BY scheme_code;

CREATE MATERIALIZED VIEW IF NOT EXISTS scheme_nav_bounds_ins TO scheme_nav_bounds AS
SELECT
    scheme_code,
    min(date) AS first_date,
    max(date) AS last_date,
    argMaxState(nav, (date, ingested_at)) AS last_nav
FROM nav
GROUP BY scheme_code;

-- Outcome of the last full-history fetch per scheme ('ok' | 'empty' | 'error').
CREATE TABLE IF NOT EXISTS fetch_status
(
    scheme_code UInt32,
    status      LowCardinality(String),
    rows        UInt32,
    first_date  Nullable(Date),
    last_date   Nullable(Date),
    error       String,
    fetched_at  DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY scheme_code;

-- One row per pipeline step (ingest, each refresh step, and the run as a whole).
CREATE TABLE IF NOT EXISTS pipeline_log
(
    run_id      UUID,
    step        LowCardinality(String),
    status      LowCardinality(String),
    started_at  DateTime64(3),
    finished_at DateTime64(3),
    details     String
)
ENGINE = MergeTree
ORDER BY (started_at, step);

-- Config tables, rewritten from config/ on every run by `mf sync-config`.
CREATE TABLE IF NOT EXISTS settings
(
    key   String,
    value Float64
)
ENGINE = MergeTree
ORDER BY key;

CREATE TABLE IF NOT EXISTS category_map
(
    raw_category String,
    asset_class  LowCardinality(String),
    category     LowCardinality(String),
    rankable     UInt8
)
ENGINE = MergeTree
ORDER BY raw_category;

CREATE TABLE IF NOT EXISTS benchmark_proxy
(
    category    LowCardinality(String),
    scheme_code UInt32,
    index_name  String
)
ENGINE = MergeTree
ORDER BY category;

-- Peer ranks within category x plan, appended by every refresh (sql/derived/fund_ranks) so rank
-- history is kept. Re-running for the same as_of_date replaces that day's rows
-- (ReplacingMergeTree; read with FINAL). rank 1 = best; percentile 100 = best; quartile 1 = top.
CREATE TABLE IF NOT EXISTS fund_ranks
(
    as_of_date  Date,
    metric      LowCardinality(String),
    scheme_code UInt32,
    category    LowCardinality(String),
    plan        LowCardinality(String),
    value       Float64,
    rank        UInt32,
    peers       UInt32,
    percentile  Float64,
    quartile    UInt8,
    computed_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(computed_at)
ORDER BY (as_of_date, metric, scheme_code);

-- Upgrade from the pre-release layout, where every metric table was fed by a refreshable
-- materialized view `<table>_mv`. Those views also fired on every server restart, all at once and
-- in no particular order. The tables they fed are replaced by the next `mf refresh`.
DROP VIEW IF EXISTS nav_glitches_mv;
DROP VIEW IF EXISTS nav_adjustments_mv;
DROP VIEW IF EXISTS nav_clean_mv;
DROP VIEW IF EXISTS scheme_info_mv;
DROP VIEW IF EXISTS scheme_siblings_mv;
DROP VIEW IF EXISTS category_index_mv;
DROP VIEW IF EXISTS benchmark_daily_mv;
DROP VIEW IF EXISTS fund_daily_mv;
DROP VIEW IF EXISTS fund_monthly_mv;
DROP VIEW IF EXISTS fund_returns_mv;
DROP VIEW IF EXISTS fund_price_stats_mv;
DROP VIEW IF EXISTS fund_period_returns_mv;
DROP VIEW IF EXISTS fund_risk_mv;
DROP VIEW IF EXISTS fund_drawdowns_mv;
DROP VIEW IF EXISTS fund_relative_mv;
DROP VIEW IF EXISTS fund_rolling_mv;
DROP VIEW IF EXISTS fund_sip_mv;
DROP VIEW IF EXISTS idcw_events_mv;
DROP VIEW IF EXISTS data_quality_mv;
DROP VIEW IF EXISTS fund_metrics_mv;
DROP VIEW IF EXISTS fund_ranks_mv;
DROP VIEW IF EXISTS category_stats_mv;
DROP VIEW IF EXISTS fund_house_stats_mv;
-- folded into fund_metrics
DROP TABLE IF EXISTS fund_price_stats;
-- the old migration ledger (its checksums describe files that no longer exist)
DROP TABLE IF EXISTS schema_migrations;
