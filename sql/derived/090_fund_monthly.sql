-- Monthly fact table: month-end NAV (last NAV in the calendar month) and the return since the
-- previous month-end, plus benchmark returns over the same two dates. Morningstar and Value
-- Research compute standard deviation, Sharpe, beta and alpha from monthly returns; the monthly
-- risk metrics use this table. is_complete = 0 for a month that has not finished yet.
CREATE OR REPLACE TABLE fund_monthly
(
    scheme_code UInt32,
    month       Date,
    date        Date,
    nav         Float64,
    prev_date   Date,
    prev_nav    Float64,
    ret         Float64,
    rf_ret      Float64,
    cat_ret     Nullable(Float64),
    idx_ret     Nullable(Float64),
    is_complete UInt8
)
ENGINE = MergeTree
ORDER BY (scheme_code, month)
AS
SELECT
    m.scheme_code AS scheme_code, m.month AS month, m.date AS date, m.nav AS nav,
    m.prev_date AS prev_date, m.prev_nav AS prev_nav, m.nav / m.prev_nav - 1 AS ret,
    rf1.level / rf0.level - 1 AS rf_ret,
    c1.level / c0.level - 1 AS cat_ret,
    p1.level / p0.level - 1 AS idx_ret,
    m.is_complete AS is_complete
FROM
(
    SELECT
        scheme_code, month, date, nav, cat_key, idx_key, is_complete,
        lagInFrame(month, 1, toDate(0)) OVER w AS prev_month,
        lagInFrame(date, 1, toDate(0)) OVER w AS prev_date,
        lagInFrame(nav, 1, 0.) OVER w AS prev_nav
    FROM
    (
        SELECT n.scheme_code AS scheme_code, toStartOfMonth(n.date) AS month,
               max(n.date) AS date, argMax(n.nav, n.date) AS nav,
               any(concat('cat|', i.category, '|', i.plan)) AS cat_key,
               any(if(bp.scheme_code > 0, concat('proxy|', toString(bp.scheme_code)), '')) AS idx_key,
               -- complete once the market has reached the month's last calendar day (active
               -- schemes), or once the scheme has a NAV in a later month
               toUInt8(month < toStartOfMonth(any(i.last_nav_date))
                       OR (any(i.is_active) AND toLastDayOfMonth(month) <= any(i.as_of_date))) AS is_complete
        FROM nav_clean AS n
        INNER JOIN scheme_info AS i ON i.scheme_code = n.scheme_code
        LEFT JOIN benchmark_proxy AS bp ON bp.category = i.category
        GROUP BY scheme_code, month
    )
    WINDOW w AS (PARTITION BY scheme_code ORDER BY month ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
) AS m
INNER JOIN (SELECT date, level FROM benchmark_daily WHERE bench_key = 'rf') AS rf1 ON rf1.date = m.date
INNER JOIN (SELECT date, level FROM benchmark_daily WHERE bench_key = 'rf') AS rf0 ON rf0.date = m.prev_date
LEFT JOIN benchmark_daily AS c1 ON c1.bench_key = m.cat_key AND c1.date = m.date
LEFT JOIN benchmark_daily AS c0 ON c0.bench_key = m.cat_key AND c0.date = m.prev_date
LEFT JOIN benchmark_daily AS p1 ON p1.bench_key = m.idx_key AND p1.date = m.date
LEFT JOIN benchmark_daily AS p0 ON p0.bench_key = m.idx_key AND p0.date = m.prev_date
-- Only consecutive months: a month after a gap would span several months.
WHERE m.prev_nav > 0 AND m.prev_month = addMonths(m.month, -1)
SETTINGS join_use_nulls = 1
