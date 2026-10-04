-- The analytics base series: one NAV per scheme per date, glitches removed, restated in the
-- current unit across face-value changes (`raw_nav` keeps the published NAV), with the previous
-- NAV and the simple return since it. prev_nav = 0 marks a scheme's first NAV.
CREATE OR REPLACE TABLE nav_clean
(
    scheme_code UInt32,
    date        Date,
    nav         Float64,
    raw_nav     Float64,
    prev_date   Date,
    prev_nav    Float64,
    ret         Float64,
    gap_days    UInt16
)
ENGINE = MergeTree
ORDER BY (scheme_code, date)
AS
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
        SELECT scheme_code, date, nav
        FROM nav FINAL
        WHERE (scheme_code, date) NOT IN (SELECT scheme_code, date FROM nav_glitches)
    ) AS n
    LEFT JOIN
    (
        SELECT scheme_code, groupArray((date, factor)) AS adj FROM nav_adjustments GROUP BY scheme_code
    ) AS a ON a.scheme_code = n.scheme_code
)
WINDOW w AS (PARTITION BY scheme_code ORDER BY date ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
