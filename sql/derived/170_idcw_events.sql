-- IDCW payouts inferred from NAVs: on a payout date an IDCW plan's NAV falls by the payout
-- while its Growth sibling (same scheme, same plan) does not. payout_per_unit is the gap
-- between the IDCW NAV and where it would be had it moved with the Growth option.
CREATE OR REPLACE TABLE idcw_events
(
    scheme_code     UInt32,
    date            Date,
    growth_code     UInt32,
    idcw_ret        Float64,
    growth_ret      Float64,
    payout_per_unit Float64,
    payout_pct      Float64
)
ENGINE = MergeTree
ORDER BY (scheme_code, date)
AS
WITH (SELECT any(value) FROM settings WHERE key = 'idcw_min_gap') AS min_gap
SELECT
    d.scheme_code AS scheme_code,
    d.date AS date,
    s.sibling_code AS growth_code,
    d.ret AS idcw_ret,
    g.ret AS growth_ret,
    d.prev_nav * (1 + g.ret) - d.nav AS payout_per_unit,
    payout_per_unit / d.prev_nav AS payout_pct
FROM
(
    SELECT scheme_code, date, prev_date, nav, prev_nav, ret FROM nav_clean
    WHERE prev_nav > 0
      AND scheme_code IN (SELECT scheme_code FROM scheme_siblings WHERE relation = 'growth')
      -- Bonus options distribute units, not cash; their NAV drops are not payouts
      AND scheme_code IN (SELECT scheme_code FROM scheme_info WHERE option = 'IDCW')
) AS d
INNER JOIN (SELECT scheme_code, sibling_code FROM scheme_siblings WHERE relation = 'growth') AS s
    ON s.scheme_code = d.scheme_code
INNER JOIN
(
    SELECT scheme_code, date, prev_date, ret FROM nav_clean
    WHERE prev_nav > 0
      AND scheme_code IN (SELECT sibling_code FROM scheme_siblings WHERE relation = 'growth')
) AS g
    ON g.scheme_code = s.sibling_code AND g.date = d.date
WHERE g.prev_date = d.prev_date AND g.ret - d.ret >= min_gap
