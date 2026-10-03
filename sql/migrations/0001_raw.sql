-- Raw layer: what the ingester writes. Everything downstream is derived by materialized views.

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
-- earlier one, so corrections published by AMCs flow through.
CREATE TABLE IF NOT EXISTS nav
(
    scheme_code UInt32,
    date        Date,
    nav         Float64,
    ingested_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (scheme_code, date);

-- Insert-triggered MV: newest/oldest NAV date per scheme, maintained on every insert. Only
-- duplicate-safe aggregates (min/max/argMax) are used, since ReplacingMergeTree may hold
-- duplicate rows until merges run. The ingester reads this to detect missed trading days.
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

-- One row per pipeline step (ingest, each view refresh, and the run as a whole).
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
