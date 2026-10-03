-- Every benchmark-like series as a level on every calendar day (forward-filled), so a return
-- over any fund interval (prev_date, date] is a two-key lookup:
--   'cat|<category>|<plan>' category index, 'proxy|<code>' index-fund proxy NAV,
--   'rf' risk-free: the liquid-fund proxy NAV, extended backwards before its first NAV at the
--        configured fallback rate (or entirely synthetic if no proxy is configured).
CREATE OR REPLACE TABLE benchmark_daily
(
    bench_key LowCardinality(String),
    date      Date,
    level     Float64
)
ENGINE = MergeTree
ORDER BY (bench_key, date)
AS
WITH
    -- scalar subqueries are Nullable; ifNull keeps the arithmetic below non-nullable
    ifNull((SELECT toUInt32(any(value)) FROM settings WHERE key = 'risk_free_proxy_scheme_code'), 0) AS rf_code,
    ifNull((SELECT any(value) FROM settings WHERE key = 'risk_free_fallback_rate'), 0.) AS rf_fallback,
    ifNull((SELECT min(date) FROM nav_clean), toDate(0)) AS d0,
    ifNull((SELECT max(date) FROM nav_clean), toDate(0)) AS d1,
    source AS
    (
        SELECT concat('cat|', category, '|', plan) AS bench_key, date, level FROM category_index
        UNION ALL
        SELECT concat('proxy|', toString(scheme_code)), date, nav FROM nav_clean
        WHERE scheme_code IN (SELECT scheme_code FROM benchmark_proxy) OR scheme_code = rf_code
    ),
    filled AS
    (
        SELECT cal.bench_key AS bench_key, cal.date AS date, s.level AS level
        FROM
        (
            SELECT bench_key, first_date + number AS date
            FROM (SELECT bench_key, min(date) AS first_date FROM source GROUP BY bench_key)
            ARRAY JOIN range(toUInt32(greatest(dateDiff('day', first_date, d1), 0) + 1)) AS number
        ) AS cal
        ASOF INNER JOIN source AS s ON s.bench_key = cal.bench_key AND cal.date >= s.date
    ),
    rf_proxy AS (SELECT date, level FROM filled WHERE bench_key = concat('proxy|', toString(rf_code))),
    ifNull((SELECT min(date) FROM rf_proxy), toDate(0)) AS rf_first,
    ifNull((SELECT argMin(level, date) FROM rf_proxy), 0.) AS rf_first_level
SELECT bench_key, date, level FROM filled
UNION ALL
SELECT 'rf', date, level FROM rf_proxy
UNION ALL
-- Before the proxy exists: compound the fallback rate backwards from the proxy's first level.
SELECT 'rf', d0 + number AS date,
       if(rf_first_level > 0, rf_first_level, 1.)
         * pow(1 + rf_fallback, dateDiff('day', if(rf_first_level > 0, rf_first, d1), date) / 365.)
FROM numbers(toUInt32(greatest(dateDiff('day', d0, if(rf_first_level > 0, rf_first - 1, d1)) + 1, 0)))
