-- Unit changes: face-value redenominations (e.g. UTI Overnight Fund x100 on 2018-05-03, UTI Liquid
-- Fund /10 on 2026-06-20) and ETF unit splits (1:5, 1:10, 1:50, 1:100). The published NAV jumps by
-- that factor overnight with no gain or loss to investors. A jump is recognised when the one-day
-- move (glitches removed) is at least 75% and the ratio is within ~4.7% of a split factor; NAVs
-- before it are restated in the new unit (nav_clean), like a stock-split adjustment. Genuine large
-- moves (e.g. a credit write-down of -50% and its later recovery) never match a factor.
CREATE OR REPLACE TABLE nav_adjustments
(
    scheme_code UInt32,
    date        Date,
    prev_nav    Float64,
    nav         Float64,
    factor      Float64     -- new unit / old unit; earlier NAVs are multiplied by this
)
ENGINE = MergeTree
ORDER BY (scheme_code, date)
AS
SELECT scheme_code, date, prev_nav, nav, f AS factor
FROM
(
    SELECT scheme_code, date, nav, lagInFrame(nav, 1, 0.) OVER w AS prev_nav
    FROM nav FINAL
    WHERE (scheme_code, date) NOT IN (SELECT scheme_code, date FROM nav_glitches)
    WINDOW w AS (PARTITION BY scheme_code ORDER BY date ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
)
ARRAY JOIN [arrayFirst(x -> abs(log10(nav / prev_nav) - log10(x)) < 0.02,
                       [5., 10., 20., 50., 100., 200., 500., 1000., 10000.,
                        0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0001])] AS f
WHERE prev_nav > 0 AND abs(nav / prev_nav - 1) >= 0.75 AND f > 0
