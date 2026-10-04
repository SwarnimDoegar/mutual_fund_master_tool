-- Per-fund metrics (files 100-190). Every window ends at the scheme's
-- own latest NAV (daily basis) or its last complete month (monthly basis), so closed schemes
-- keep metrics as of their final NAV.
--
-- Conventions (Morningstar methodology, as used by Value Research for Indian funds):
--   * "N years ago" = the nearest NAV on or before that date; windows the fund didn't fully
--     exist for are omitted, never extrapolated.
--   * Returns: absolute up to 1Y, CAGR beyond. CAGR = (end/start)^(1/years) - 1.
--   * Volatility = sample stdev of period returns x sqrt(periods per year). Periods per year is
--     12 on the monthly basis and the observed NAV count per year on the daily basis (about 248
--     for equity funds, about 365 for liquid funds that publish every calendar day).
--   * Sharpe = mean(R - Rf) / stdev(R - Rf) x sqrt(ppy). Sortino = mean(R - Rf) x ppy over the
--     annualised downside deviation sqrt(mean(min(R - Rf, 0)^2) x ppy).
--   * Alpha/beta: regression of fund excess returns on benchmark excess returns; alpha x ppy.
--   * Capture ratios use annualised geometric returns over periods with benchmark >= 0 (up)
--     or < 0 (down). Batting average counts periods the fund beat or matched the benchmark.

-- Point-to-point (trailing) returns.
CREATE OR REPLACE TABLE fund_returns
(
    scheme_code   UInt32,
    horizon       LowCardinality(String),
    horizon_order UInt8,
    start_date    Date,
    start_nav     Float64,
    end_date      Date,
    end_nav       Float64,
    years         Nullable(Float64),
    abs_return    Float64,
    cagr          Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (scheme_code, horizon_order)
AS
SELECT
    scheme_code,
    h.1 AS horizon,
    h.2 AS horizon_order,
    st.1 AS start_date,
    st.2 AS start_nav,
    end_date,
    end_nav,
    if(h.1 = 'SI', dateDiff('day', start_date, end_date) / 365.25, h.4) AS years,
    end_nav / start_nav - 1 AS abs_return,
    if(years >= 1, pow(end_nav / start_nav, 1 / years) - 1, NULL) AS cagr
FROM
(
    SELECT scheme_code, arraySort(x -> x.1, groupArray((date, nav))) AS s,
           s[-1].1 AS end_date, s[-1].2 AS end_nav
    FROM nav_clean
    GROUP BY scheme_code
)
ARRAY JOIN arrayZip(
    ['1D', '1W', '1M', '3M', '6M', 'YTD', 'FYTD', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '15Y', '20Y', 'SI'],
    range(1, 17),
    [
        if(length(s) >= 2, s[-2].1, toDate(0)),
        end_date - 7,
        addMonths(end_date, -1), addMonths(end_date, -3), addMonths(end_date, -6),
        makeDate(toYear(end_date) - 1, 12, 31),
        makeDate(if(toMonth(end_date) >= 4, toYear(end_date), toYear(end_date) - 1), 3, 31),
        addYears(end_date, -1), addYears(end_date, -2), addYears(end_date, -3), addYears(end_date, -5),
        addYears(end_date, -7), addYears(end_date, -10), addYears(end_date, -15), addYears(end_date, -20),
        s[1].1
    ],
    [CAST(NULL AS Nullable(Float64)), NULL, NULL, NULL, NULL, NULL, NULL, 1., 2., 3., 5., 7., 10., 15., 20., NULL]
) AS h
ARRAY JOIN [arrayLast(x -> x.1 <= h.3, s)] AS st
WHERE st.2 > 0
  AND st.1 < end_date
  -- the start NAV must be close to the target date (no stale prices across long gaps)
  AND (h.1 IN ('1D', 'SI') OR dateDiff('day', st.1, h.3) <= 10)
