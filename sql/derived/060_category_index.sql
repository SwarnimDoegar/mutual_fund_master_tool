-- Equal-weighted category index per (category, plan), base 100. Members are the open-ended,
-- rankable, non-legacy Growth funds of the category; funds that later closed stay in for the
-- days they existed (no survivorship bias). Category membership uses each fund's current category.
--
-- 1. Index dates: days on which at least 3 members published a NAV and at least half as many as
--    on the month's busiest day (some AMCs publish stray weekend NAVs; three funds must not stand
--    in for a 30-fund category).
-- 2. Between consecutive index dates p -> d, a member's return is NAV(d) / NAV(p) - 1, for members
--    with a NAV on both dates. A fund that missed p is left out of p -> d rather than counting a
--    multi-day catch-up as one interval's move, and a rejected thin day in between loses nothing.
-- 3. The index return is the mean member return; levels chain those returns. A return of 25% or
--    more over one day (scaled by sqrt(days) over longer intervals) is treated as a bad tick.
CREATE OR REPLACE TABLE category_index
(
    category LowCardinality(String),
    plan     LowCardinality(String),
    date     Date,
    ret      Float64,
    n_funds  UInt32,
    level    Float64
)
ENGINE = MergeTree
ORDER BY (category, plan, date)
AS
SELECT
    category, plan, date, ret, n_funds,
    100 * exp(sum(log1p(ret)) OVER (PARTITION BY category, plan ORDER BY date
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS level
FROM
(
    SELECT category, plan, date, avg(nav / prev_nav - 1) AS ret, toUInt32(count()) AS n_funds
    FROM
    (
        -- each member's previous NAV on an index date
        SELECT *,
               lagInFrame(date, 1, toDate(0)) OVER (PARTITION BY scheme_code ORDER BY date
                                                    ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS prev_date,
               lagInFrame(nav, 1, 0.) OVER (PARTITION BY scheme_code ORDER BY date
                                            ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS prev_nav
        FROM
        (
            -- members' NAVs on index dates, with the category's previous index date
            SELECT *, max(date) OVER (PARTITION BY category, plan ORDER BY date
                                      RANGE BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS index_prev_date
            FROM
            (
                SELECT *, max(n) OVER (PARTITION BY category, plan, toStartOfMonth(date)) AS month_max
                FROM
                (
                    SELECT i.category AS category, i.plan AS plan, n.scheme_code AS scheme_code,
                           n.date AS date, n.nav AS nav,
                           count() OVER (PARTITION BY i.category, i.plan, n.date) AS n
                    FROM nav_clean AS n
                    INNER JOIN scheme_info AS i ON i.scheme_code = n.scheme_code
                    WHERE i.option = 'Growth' AND i.rankable_category AND NOT i.is_legacy_plan
                      AND i.scheme_type = 'Open Ended Schemes'
                )
            )
            WHERE n >= 3 AND n >= month_max / 2
        )
    )
    WHERE prev_nav > 0
      AND prev_date = index_prev_date
      AND abs(nav / prev_nav - 1) < 0.25 * sqrt(dateDiff('day', prev_date, date))
    GROUP BY category, plan, date
)
