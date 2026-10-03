-- Daily fact table for window metrics: every NAV-to-NAV return with the risk-free, category and
-- index-proxy returns over the exact same interval. cat_ret/idx_ret are NULL where that
-- benchmark has no data for the interval.
CREATE OR REPLACE TABLE fund_daily
(
    scheme_code UInt32,
    date        Date,
    prev_date   Date,
    nav         Float64,
    prev_nav    Float64,
    ret         Float64,
    rf_ret      Float64,
    cat_ret     Nullable(Float64),
    idx_ret     Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (scheme_code, date)
AS
SELECT
    n.scheme_code AS scheme_code, n.date AS date, n.prev_date AS prev_date,
    n.nav AS nav, n.prev_nav AS prev_nav, n.ret AS ret,
    rf1.level / rf0.level - 1 AS rf_ret,
    c1.level / c0.level - 1 AS cat_ret,
    p1.level / p0.level - 1 AS idx_ret
FROM
(
    SELECT n.scheme_code, n.date, n.prev_date, n.nav, n.prev_nav, n.ret,
           concat('cat|', i.category, '|', i.plan) AS cat_key,
           if(bp.scheme_code > 0, concat('proxy|', toString(bp.scheme_code)), '') AS idx_key
    FROM nav_clean AS n
    INNER JOIN scheme_info AS i ON i.scheme_code = n.scheme_code
    LEFT JOIN benchmark_proxy AS bp ON bp.category = i.category
    WHERE n.prev_nav > 0
) AS n
INNER JOIN (SELECT date, level FROM benchmark_daily WHERE bench_key = 'rf') AS rf1 ON rf1.date = n.date
INNER JOIN (SELECT date, level FROM benchmark_daily WHERE bench_key = 'rf') AS rf0 ON rf0.date = n.prev_date
LEFT JOIN benchmark_daily AS c1 ON c1.bench_key = n.cat_key AND c1.date = n.date
LEFT JOIN benchmark_daily AS c0 ON c0.bench_key = n.cat_key AND c0.date = n.prev_date
LEFT JOIN benchmark_daily AS p1 ON p1.bench_key = n.idx_key AND p1.date = n.date
LEFT JOIN benchmark_daily AS p0 ON p0.bench_key = n.idx_key AND p0.date = n.prev_date
SETTINGS join_use_nulls = 1
