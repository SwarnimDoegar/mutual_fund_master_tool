-- Calendar-month, quarter, calendar-year and Indian financial-year (Apr-Mar) returns, each
-- measured from the previous period's last NAV. The first period (from inception) and the
-- unfinished current period are flagged is_partial.
CREATE OR REPLACE TABLE fund_period_returns
(
    scheme_code  UInt32,
    period_type  LowCardinality(String),   -- month | quarter | year | fy
    period_start Date,
    start_date   Date,
    start_nav    Float64,
    end_date     Date,
    end_nav      Float64,
    ret          Float64,
    is_partial   UInt8
)
ENGINE = MergeTree
ORDER BY (scheme_code, period_type, period_start)
AS
SELECT
    p.scheme_code AS scheme_code,
    p.period_type AS period_type,
    p.period_start AS period_start,
    if(consecutive, p.prev_end_date, p.first_date) AS start_date,
    if(consecutive, p.prev_end_nav, p.first_nav) AS start_nav,
    p.end_date AS end_date,
    p.end_nav AS end_nav,
    end_nav / start_nav - 1 AS ret,
    toUInt8(NOT consecutive
            OR (p.end_date = i.last_nav_date AND p.period_end > i.last_nav_date)) AS is_partial
FROM
(
    SELECT
        *,
        multiIf(period_type = 'month', addMonths(period_start, 1),
                period_type = 'quarter', addMonths(period_start, 3),
                addYears(period_start, 1)) - 1 AS period_end,
        lagInFrame(period_start, 1, toDate(0)) OVER w AS prev_start,
        lagInFrame(end_date, 1, toDate(0)) OVER w AS prev_end_date,
        lagInFrame(end_nav, 1, 0.) OVER w AS prev_end_nav,
        prev_end_nav > 0 AND prev_start = multiIf(period_type = 'month', addMonths(period_start, -1),
                                                  period_type = 'quarter', addMonths(period_start, -3),
                                                  addYears(period_start, -1)) AS consecutive
    FROM
    (
        SELECT scheme_code, p.1 AS period_type, p.2 AS period_start,
               min(date) AS first_date, argMin(nav, date) AS first_nav,
               max(date) AS end_date, argMax(nav, date) AS end_nav
        FROM nav_clean
        ARRAY JOIN [('month', toStartOfMonth(date)), ('quarter', toStartOfQuarter(date)),
                    ('year', toStartOfYear(date)),
                    ('fy', makeDate(if(toMonth(date) >= 4, toYear(date), toYear(date) - 1), 4, 1))] AS p
        GROUP BY scheme_code, period_type, period_start
    )
    WINDOW w AS (PARTITION BY scheme_code, period_type ORDER BY period_start
                 ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
) AS p
INNER JOIN scheme_info AS i ON i.scheme_code = p.scheme_code
WHERE start_nav > 0 AND start_date < end_date
