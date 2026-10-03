-- Rolling returns: for every NAV date t with enough history, the annualised return from the
-- nearest NAV on or before t minus N years (within 10 days). Summarised as a distribution per window, compared
-- with the category index's rolling return over exactly the same dates.
CREATE OR REPLACE TABLE fund_rolling
(
    scheme_code       UInt32,
    period            LowCardinality(String),   -- 1Y | 3Y | 5Y | 10Y
    years             UInt8,
    n_periods         UInt32,
    first_end_date    Date,
    last_end_date     Date,
    min_return        Float64,
    p05               Float64,
    p25               Float64,
    median            Float64,
    p75               Float64,
    p95               Float64,
    max_return        Float64,
    mean_return       Float64,
    stddev            Float64,
    latest_return     Float64,
    pct_negative      Float64,
    pct_above_7       Float64,
    pct_above_10      Float64,
    pct_above_12      Float64,
    pct_above_15      Float64,
    category_median   Nullable(Float64),
    pct_beat_category Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (scheme_code, period)
AS
SELECT
    scheme_code, period, years, n_periods, first_end_date, last_end_date, min_return,
    q[1] AS p05, q[2] AS p25, q[3] AS median, q[4] AS p75, q[5] AS p95,
    max_return, mean_return, stddev, latest_return, pct_negative, pct_above_7, pct_above_10,
    pct_above_12, pct_above_15, category_median, pct_beat_category
FROM
(
    SELECT
        scheme_code,
        concat(toString(y), 'Y') AS period,
        toUInt8(y) AS years,
        toUInt32(count()) AS n_periods,
        min(date) AS first_end_date,
        max(date) AS last_end_date,
        min(rr) AS min_return,
        -- one combined state: separate quantile functions would each keep a copy of the values
        quantilesExactInclusive(0.05, 0.25, 0.5, 0.75, 0.95)(rr) AS q,
        max(rr) AS max_return,
        avg(rr) AS mean_return,
        stddevSamp(rr) AS stddev,
        argMax(rr, date) AS latest_return,
        countIf(rr < 0) / count() AS pct_negative,
        countIf(rr > 0.07) / count() AS pct_above_7,
        countIf(rr > 0.10) / count() AS pct_above_10,
        countIf(rr > 0.12) / count() AS pct_above_12,
        countIf(rr > 0.15) / count() AS pct_above_15,
        if(count(cr) = count(), quantileExactInclusive(0.5)(cr), NULL) AS category_median,
        if(count(cr) = count(), countIf(rr > cr) / count(), NULL) AS pct_beat_category
    FROM
    (
        SELECT
            r.scheme_code AS scheme_code, r.y AS y, r.date AS date,
            pow(r.nav / r.start_nav, 1 / r.y) - 1 AS rr,
            -- category over the same two dates as the fund
            pow(c1.level / c0.level, 1 / r.y) - 1 AS cr
        FROM
        (
            SELECT scheme_code, date, nav, cat_key, w.1 AS y, w.2 AS start_nav, w.3 AS start_date
            FROM
            (
                -- The start NAV for t is the last NAV on or before t minus N years. With
                -- k = year*372 + (month-1)*31 + (day-1), "N years earlier" is exactly k - 372*N
                -- (Feb 29 falls back to Feb 28, as addYears does), so it is a RANGE frame ending
                -- 372*N before the current row: one sorted pass instead of an ASOF join.
                SELECT
                    n.scheme_code AS scheme_code, n.date AS date, n.nav AS nav,
                    concat('cat|', i.category, '|', i.plan) AS cat_key,
                    toYear(n.date) * 372 + (toMonth(n.date) - 1) * 31 + (toDayOfMonth(n.date) - 1) AS k,
                    last_value(n.nav) OVER w1 AS nav1, last_value(n.date) OVER w1 AS date1,
                    last_value(n.nav) OVER w3 AS nav3, last_value(n.date) OVER w3 AS date3,
                    last_value(n.nav) OVER w5 AS nav5, last_value(n.date) OVER w5 AS date5,
                    last_value(n.nav) OVER w10 AS nav10, last_value(n.date) OVER w10 AS date10
                FROM nav_clean AS n
                INNER JOIN scheme_info AS i ON i.scheme_code = n.scheme_code
                WINDOW
                    w1 AS (PARTITION BY n.scheme_code ORDER BY k RANGE BETWEEN UNBOUNDED PRECEDING AND 372 PRECEDING),
                    w3 AS (PARTITION BY n.scheme_code ORDER BY k RANGE BETWEEN UNBOUNDED PRECEDING AND 1116 PRECEDING),
                    w5 AS (PARTITION BY n.scheme_code ORDER BY k RANGE BETWEEN UNBOUNDED PRECEDING AND 1860 PRECEDING),
                    w10 AS (PARTITION BY n.scheme_code ORDER BY k RANGE BETWEEN UNBOUNDED PRECEDING AND 3720 PRECEDING)
            )
            ARRAY JOIN [(1, nav1, date1), (3, nav3, date3), (5, nav5, date5), (10, nav10, date10)] AS w
            -- a start NAV must exist and be within 10 days of the target date
            WHERE w.2 > 0 AND dateDiff('day', w.3, addYears(date, -toInt32(w.1))) <= 10
        ) AS r
        LEFT JOIN benchmark_daily AS c1 ON c1.bench_key = r.cat_key AND c1.date = r.date
        LEFT JOIN benchmark_daily AS c0 ON c0.bench_key = r.cat_key AND c0.date = r.start_date
    )
    GROUP BY scheme_code, y
)
SETTINGS join_use_nulls = 1
