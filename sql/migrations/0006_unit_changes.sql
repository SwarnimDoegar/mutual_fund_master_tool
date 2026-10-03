-- Unit changes (face-value redenominations and ETF unit splits) and a sturdier category index.
--
-- AMCs occasionally change a scheme's face value (e.g. UTI Overnight Fund x100 on 2018-05-03,
-- UTI Liquid Fund /10 on 2026-06-20) and ETFs split units (1:5, 1:10, 1:50, 1:100). The
-- published NAV then jumps by that factor overnight with no gain or loss to investors. Such a
-- jump is recognised when the one-day move is at least 75% and the ratio is within ~4.7% of a
-- split factor; NAVs before it are restated in the new unit, like a stock-split adjustment.
-- Genuine large moves (e.g. a credit write-down of -50% and its later recovery) never match a
-- factor, so they are kept.

CREATE TABLE IF NOT EXISTS nav_adjustments
(
    scheme_code UInt32,
    date        Date,
    prev_nav    Float64,
    nav         Float64,
    factor      Float64     -- new unit / old unit; earlier NAVs are multiplied by this
)
ENGINE = MergeTree
ORDER BY (scheme_code, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS nav_adjustments_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO nav_adjustments EMPTY AS
SELECT scheme_code, date, prev_nav, nav, f AS factor
FROM
(
    SELECT scheme_code, date, nav, lagInFrame(nav, 1, 0.) OVER w AS prev_nav
    FROM
    (
        SELECT scheme_code, date, argMax(nav, ingested_at) AS nav
        FROM nav
        WHERE (scheme_code, date) NOT IN (SELECT scheme_code, date FROM nav_glitches)
        GROUP BY scheme_code, date
    )
    WINDOW w AS (PARTITION BY scheme_code ORDER BY date ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
)
ARRAY JOIN [arrayFirst(x -> abs(log10(nav / prev_nav) - log10(x)) < 0.02,
                       [5., 10., 20., 50., 100., 200., 500., 1000., 10000.,
                        0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0001])] AS f
WHERE prev_nav > 0 AND abs(nav / prev_nav - 1) >= 0.75 AND f > 0;

-- nav_clean now carries the unit-adjusted NAV in `nav` and the published NAV in `raw_nav`.
ALTER TABLE nav_clean ADD COLUMN IF NOT EXISTS raw_nav Float64 AFTER nav;

DROP TABLE IF EXISTS nav_clean_mv SYNC;

CREATE MATERIALIZED VIEW nav_clean_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO nav_clean EMPTY AS
SELECT
    scheme_code,
    date,
    nav,
    raw_nav,
    lagInFrame(date, 1, toDate(0)) OVER w AS prev_date,
    lagInFrame(nav, 1, 0.) OVER w AS prev_nav,
    if(prev_nav > 0, nav / prev_nav - 1, 0.) AS ret,
    toUInt16(if(prev_nav > 0, dateDiff('day', prev_date, date), 0)) AS gap_days
FROM
(
    SELECT
        n.scheme_code AS scheme_code,
        n.date AS date,
        n.nav AS raw_nav,
        -- restate in the current unit: multiply by every factor dated after this NAV
        -- (exact product of the factors; arrayProduct of an empty array is 0, hence the guard)
        arrayMap(x -> x.2, arrayFilter(x -> x.1 > n.date, a.adj)) AS later_factors,
        n.nav * if(empty(later_factors), 1., arrayProduct(later_factors)) AS nav
    FROM
    (
        SELECT scheme_code, date, argMax(nav, ingested_at) AS nav
        FROM nav
        WHERE (scheme_code, date) NOT IN (SELECT scheme_code, date FROM nav_glitches)
        GROUP BY scheme_code, date
    ) AS n
    LEFT JOIN
    (
        SELECT scheme_code, groupArray((date, factor)) AS adj FROM nav_adjustments GROUP BY scheme_code
    ) AS a ON a.scheme_code = n.scheme_code
)
WINDOW w AS (PARTITION BY scheme_code ORDER BY date ROWS BETWEEN 1 PRECEDING AND CURRENT ROW);

DROP TABLE IF EXISTS category_index_mv SYNC;

CREATE MATERIALIZED VIEW category_index_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO category_index EMPTY AS
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
WHERE n_funds >= month_max / 2;

ALTER TABLE data_quality ADD COLUMN IF NOT EXISTS unit_changes UInt64 AFTER glitches_removed;

DROP TABLE IF EXISTS data_quality_mv SYNC;

CREATE MATERIALIZED VIEW data_quality_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO data_quality EMPTY AS
SELECT
    i.scheme_code AS scheme_code,
    ifNull(r.raw_dates, 0) AS raw_dates,
    ifNull(c.clean_dates, 0) AS clean_dates,
    ifNull(g.glitches, 0) AS glitches_removed,
    ifNull(u.unit_changes, 0) AS unit_changes,
    i.inception_date AS first_date,
    i.last_nav_date AS last_date,
    ifNull(c.max_gap, 0) AS max_gap_days,
    ifNull(c.gaps_7, 0) AS gaps_over_7d,
    ifNull(c.gaps_30, 0) AS gaps_over_30d,
    c.largest_move AS largest_move,
    c.largest_move_date AS largest_move_date,
    ifNull(c.big_moves, 0) AS moves_over_10pct,
    ifNull(e.events, 0) AS idcw_events,
    toUInt8(ifNull(i.last_nav_date > i.as_of_date, 0)) AS future_dated,
    i.is_active AS is_active
FROM scheme_info AS i
LEFT JOIN (SELECT scheme_code, uniqExact(date) AS raw_dates FROM nav GROUP BY scheme_code) AS r
    ON r.scheme_code = i.scheme_code
LEFT JOIN
(
    SELECT scheme_code, count() AS clean_dates, max(gap_days) AS max_gap,
           countIf(gap_days > 7) AS gaps_7, countIf(gap_days > 30) AS gaps_30,
           argMax(ret, abs(ret)) AS largest_move, argMax(date, abs(ret)) AS largest_move_date,
           countIf(abs(ret) > 0.10) AS big_moves
    FROM nav_clean
    GROUP BY scheme_code
) AS c ON c.scheme_code = i.scheme_code
LEFT JOIN (SELECT scheme_code, count() AS glitches FROM nav_glitches GROUP BY scheme_code) AS g
    ON g.scheme_code = i.scheme_code
LEFT JOIN (SELECT scheme_code, count() AS unit_changes FROM nav_adjustments GROUP BY scheme_code) AS u
    ON u.scheme_code = i.scheme_code
LEFT JOIN (SELECT scheme_code, count() AS events FROM idcw_events GROUP BY scheme_code) AS e
    ON e.scheme_code = i.scheme_code
SETTINGS join_use_nulls = 1;
