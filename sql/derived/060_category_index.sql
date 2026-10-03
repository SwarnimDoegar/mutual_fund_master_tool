-- Equal-weighted category index per (category, plan): the mean daily return of every Growth
-- fund in the category that published that day, chained into a level series (base 100).
-- Funds that later closed stay in for the days they existed (no survivorship bias). Category
-- membership uses each fund's current category.
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
    -- a day counts only if at least half the funds that published that month did (some AMCs
    -- publish stray weekend NAVs; three funds must not stand in for a 30-fund category)
    SELECT *, max(n_funds) OVER (PARTITION BY category, plan, toStartOfMonth(date)) AS month_max
    FROM
    (
    SELECT i.category AS category, i.plan AS plan, n.date AS date,
           avg(n.ret) AS ret, toUInt32(count()) AS n_funds
    FROM nav_clean AS n
    INNER JOIN scheme_info AS i ON i.scheme_code = n.scheme_code
    WHERE n.prev_nav > 0
      AND n.gap_days <= 7                -- skip catch-up returns after long gaps
      AND abs(n.ret) < 0.25              -- residual bad ticks must not move a category
      AND i.option = 'Growth' AND i.rankable_category AND NOT i.is_legacy_plan
      AND i.scheme_type = 'Open Ended Schemes'
    GROUP BY category, plan, date
    HAVING n_funds >= 3
    )
)
WHERE n_funds >= month_max / 2
