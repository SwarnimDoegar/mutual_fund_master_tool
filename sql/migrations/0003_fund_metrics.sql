-- Refreshable materialized views, part 2: per-fund metrics. Every window ends at the scheme's
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
CREATE TABLE IF NOT EXISTS fund_returns
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
ORDER BY (scheme_code, horizon_order);

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_returns_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_returns EMPTY AS
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
  AND (h.1 IN ('1D', 'SI') OR dateDiff('day', st.1, h.3) <= 10);

-- NAV levels: all-time and 52-week highs/lows, moving averages.
CREATE TABLE IF NOT EXISTS fund_price_stats
(
    scheme_code       UInt32,
    end_date          Date,
    nav               Float64,
    ath_nav           Float64,
    ath_date          Date,
    atl_nav           Float64,
    atl_date          Date,
    pct_below_ath     Float64,
    days_since_ath    UInt32,
    high_52w          Nullable(Float64),
    high_52w_date     Nullable(Date),
    low_52w           Nullable(Float64),
    low_52w_date      Nullable(Date),
    pct_below_52w_high Nullable(Float64),
    pct_above_52w_low Nullable(Float64),
    sma_50            Nullable(Float64),
    sma_100           Nullable(Float64),
    sma_200           Nullable(Float64),
    pct_vs_sma_200    Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY scheme_code;

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_price_stats_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_price_stats EMPTY AS
SELECT
    scheme_code,
    end_date,
    nav,
    arrayMax(navs) AS ath_nav,
    arrayLast(x -> x.2 = ath_nav, s).1 AS ath_date,
    arrayMin(navs) AS atl_nav,
    arrayLast(x -> x.2 = atl_nav, s).1 AS atl_date,
    1 - nav / ath_nav AS pct_below_ath,
    toUInt32(dateDiff('day', ath_date, end_date)) AS days_since_ath,
    if(has_year, arrayMax(x -> x.2, y), NULL) AS high_52w,
    if(has_year, arrayLast(x -> x.2 = high_52w, y).1, NULL) AS high_52w_date,
    if(has_year, arrayMin(x -> x.2, y), NULL) AS low_52w,
    if(has_year, arrayLast(x -> x.2 = low_52w, y).1, NULL) AS low_52w_date,
    1 - nav / high_52w AS pct_below_52w_high,
    nav / low_52w - 1 AS pct_above_52w_low,
    if(length(navs) >= 50, arrayAvg(arraySlice(navs, -50)), NULL) AS sma_50,
    if(length(navs) >= 100, arrayAvg(arraySlice(navs, -100)), NULL) AS sma_100,
    if(length(navs) >= 200, arrayAvg(arraySlice(navs, -200)), NULL) AS sma_200,
    nav / sma_200 - 1 AS pct_vs_sma_200
FROM
(
    SELECT *,
           arrayMap(x -> x.2, s) AS navs,
           s[-1].1 AS end_date,
           s[-1].2 AS nav,
           -- 52-week figures need a NAV at least a year old
           s[1].1 <= addYears(end_date, -1) AS has_year,
           arrayFilter(x -> x.1 > addYears(end_date, -1), s) AS y
    FROM
    (
        SELECT scheme_code, arraySort(x -> x.1, groupArray((date, nav))) AS s
        FROM nav_clean
        GROUP BY scheme_code
    )
);

-- Calendar-month, quarter, calendar-year and Indian financial-year (Apr-Mar) returns, each
-- measured from the previous period's last NAV. The first period (from inception) and the
-- unfinished current period are flagged is_partial.
CREATE TABLE IF NOT EXISTS fund_period_returns
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
ORDER BY (scheme_code, period_type, period_start);

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_period_returns_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_period_returns EMPTY AS
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
WHERE start_nav > 0 AND start_date < end_date;

-- Absolute risk, return and drawdown statistics per (basis, window). VaR/CVaR are NULL for the
-- daily 10Y and SI windows.
-- basis = 'daily' (NAV-to-NAV returns) or 'monthly' (month-end returns, complete months only).
-- window = 1Y | 3Y | 5Y | 10Y | SI (SI only once there is at least a year of history).
CREATE TABLE IF NOT EXISTS fund_risk
(
    scheme_code           UInt32,
    basis                 LowCardinality(String),
    period                LowCardinality(String),
    start_date            Date,                 -- base NAV date (returns are measured after it)
    end_date              Date,                 -- last NAV in the window (month-end NAV on monthly basis)
    years                 Float64,
    n_obs                 UInt32,
    periods_per_year      Float64,
    cagr                  Float64,
    mean_return_ann       Float64,              -- arithmetic mean x ppy
    volatility            Float64,
    downside_deviation    Float64,
    sharpe                Nullable(Float64),
    sortino               Nullable(Float64),
    calmar                Nullable(Float64),
    omega                 Nullable(Float64),
    skewness              Nullable(Float64),
    excess_kurtosis       Nullable(Float64),
    var_95                Nullable(Float64),    -- loss not exceeded in 95% of periods (positive = loss)
    var_99                Nullable(Float64),
    cvar_95               Nullable(Float64),    -- mean loss in the worst 5% of periods
    best_period           Float64,
    best_period_date      Date,
    worst_period          Float64,
    worst_period_date     Date,
    pct_positive          Float64,
    gain_loss_ratio       Nullable(Float64),
    max_drawdown          Float64,              -- <= 0
    mdd_peak_date         Date,
    mdd_trough_date       Date,
    mdd_recovery_date     Nullable(Date),       -- NULL while still below the peak
    mdd_decline_days      UInt32,
    mdd_recovery_days     Nullable(UInt32),
    current_drawdown      Float64,
    ulcer_index           Float64,
    avg_drawdown          Float64,
    pct_time_underwater   Float64
)
ENGINE = MergeTree
ORDER BY (scheme_code, basis, period);

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_risk_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_risk EMPTY AS
WITH
    windows AS
    (
        SELECT scheme_code, last_nav_date, inception_date,
               -- last complete month (see fund_monthly.is_complete)
               if(is_active AND toLastDayOfMonth(last_nav_date) <= as_of_date,
                  toStartOfMonth(last_nav_date), addMonths(toStartOfMonth(last_nav_date), -1)) AS last_month
        FROM scheme_info
        WHERE nav_count >= 2
    ),
    obs AS
    (
        -- daily: returns strictly after each window's start date
        SELECT d.scheme_code AS scheme_code, 'daily' AS basis, w.1 AS period, w.2 AS w_years,
               w.3 AS w_target, d.date AS date, d.prev_date AS prev_date, d.nav AS nav,
               d.prev_nav AS prev_nav, d.ret AS ret, d.ret - d.rf_ret AS excess
        FROM fund_daily AS d
        INNER JOIN windows AS i ON i.scheme_code = d.scheme_code
        ARRAY JOIN arrayFilter(x -> x.3 >= i.inception_date AND d.date > x.3 AND x.2 >= 1, [
            ('1Y', 1., addYears(i.last_nav_date, -1)),
            ('3Y', 3., addYears(i.last_nav_date, -3)),
            ('5Y', 5., addYears(i.last_nav_date, -5)),
            ('10Y', 10., addYears(i.last_nav_date, -10)),
            ('SI', dateDiff('day', i.inception_date, i.last_nav_date) / 365.25, i.inception_date)
        ]) AS w
        UNION ALL
        -- monthly: the N complete months ending with the last complete month
        SELECT m.scheme_code, 'monthly', w.1, w.2, w.3, m.date, m.prev_date, m.nav, m.prev_nav,
               m.ret, m.ret - m.rf_ret
        FROM fund_monthly AS m
        INNER JOIN windows AS i ON i.scheme_code = m.scheme_code
        ARRAY JOIN arrayFilter(x -> m.month > x.3 AND m.month <= i.last_month, [
            ('1Y', 1., addMonths(i.last_month, -12)),
            ('3Y', 3., addMonths(i.last_month, -36)),
            ('5Y', 5., addMonths(i.last_month, -60)),
            ('10Y', 10., addMonths(i.last_month, -120)),
            ('SI', 0., toDate(0))
        ]) AS w
        WHERE m.is_complete
    ),
    with_drawdown AS
    (
        SELECT
            *,
            -- drawdowns are measured from the window's base NAV (the NAV just before its first return)
            first_value(prev_nav) OVER pw AS base_nav,
            max(nav) OVER pw AS running_max,
            greatest(base_nav, running_max) AS peak,
            nav / peak - 1 AS dd,
            -- latest date at the running high (ties go to the later date, so getting back to a
            -- previous high counts as recovery)
            if(running_max >= base_nav, argMax(date, (nav, date)) OVER pw, first_value(prev_date) OVER pw) AS peak_date,
            peak_date = date AS at_peak
        FROM obs
        WINDOW pw AS (PARTITION BY scheme_code, basis, period ORDER BY date
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    ),
    with_recovery AS
    (
        -- second pass in reverse date order: the next date (after this row) at a new high
        SELECT *, min(if(at_peak, date, NULL)) OVER rw AS next_peak_date
        FROM with_drawdown
        WINDOW rw AS (PARTITION BY scheme_code, basis, period ORDER BY date DESC
                      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
    )
SELECT
    scheme_code, basis, period, start_date, end_date, years, n_obs, periods_per_year, cagr, mean_return_ann,
    volatility, downside_deviation, sharpe, sortino, calmar, omega, skewness, excess_kurtosis, var_95, var_99,
    cvar_95, best_period, best_period_date, worst_period, worst_period_date, pct_positive, gain_loss_ratio,
    max_drawdown, mdd_peak_date, mdd_trough_date, mdd_recovery_date, mdd_decline_days, mdd_recovery_days,
    current_drawdown, ulcer_index, avg_drawdown, pct_time_underwater
FROM
(
    SELECT
        scheme_code, basis, period,
        argMin(prev_date, date) AS start_date,
        max(date) AS end_date,
        if(basis = 'monthly', count() / 12, any(w_years)) AS years,
        toUInt32(count()) AS n_obs,
        if(basis = 'monthly', 12., count() / years) AS periods_per_year,
        pow(exp(sum(log1p(ret))), 1 / years) - 1 AS cagr,
        avg(ret) * periods_per_year AS mean_return_ann,
        stddevSamp(ret) * sqrt(periods_per_year) AS volatility,
        sqrt(avg(pow(least(excess, 0), 2)) * periods_per_year) AS downside_deviation,
        if(stddevSamp(excess) > 0, avg(excess) / stddevSamp(excess) * sqrt(periods_per_year), NULL) AS sharpe,
        if(downside_deviation > 0, avg(excess) * periods_per_year / downside_deviation, NULL) AS sortino,
        if(max_drawdown < 0, cagr / abs(max_drawdown), NULL) AS calmar,
        if(sumIf(excess, excess < 0) < 0, sumIf(excess, excess > 0) / -sumIf(excess, excess < 0), NULL) AS omega,
        if(count() >= 3, skewSamp(ret), NULL) AS skewness,
        if(count() >= 4, kurtSamp(ret) - 3, NULL) AS excess_kurtosis,
        -- historical VaR keeps every return in memory, so it is limited to the windows where it is
        -- meaningful: daily 1Y/3Y/5Y and all monthly windows
        basis = 'monthly' OR period IN ('1Y', '3Y', '5Y') AS has_var,
        arraySort(groupArrayIf(ret, basis = 'monthly' OR period IN ('1Y', '3Y', '5Y'))) AS sorted,
        toUInt32(greatest(1, ceil(0.05 * length(sorted)))) AS k95,
        toUInt32(greatest(1, ceil(0.01 * length(sorted)))) AS k99,
        if(has_var, -sorted[k95], NULL) AS var_95,
        if(has_var, -sorted[k99], NULL) AS var_99,
        if(has_var, -arrayAvg(arraySlice(sorted, 1, k95)), NULL) AS cvar_95,
        max(ret) AS best_period,
        argMax(date, ret) AS best_period_date,
        min(ret) AS worst_period,
        argMin(date, ret) AS worst_period_date,
        countIf(ret > 0) / count() AS pct_positive,
        if(countIf(ret < 0) > 0 AND avgIf(ret, ret < 0) < 0,
           (avgIf(ret, ret > 0) / abs(avgIf(ret, ret < 0))) * (countIf(ret > 0) / countIf(ret < 0)), NULL) AS gain_loss_ratio,
        min(dd) AS max_drawdown,
        argMin(peak_date, dd) AS mdd_peak_date,
        argMin(date, dd) AS mdd_trough_date,
        -- argMin skips NULL values, so carry "not recovered" as 1970-01-01 through it
        nullIf(argMin(ifNull(next_peak_date, toDate(0)), dd), toDate(0)) AS recovery,
        if(max_drawdown < 0, recovery, NULL) AS mdd_recovery_date,
        toUInt32(dateDiff('day', mdd_peak_date, mdd_trough_date)) AS mdd_decline_days,
        toUInt32(dateDiff('day', mdd_trough_date, mdd_recovery_date)) AS mdd_recovery_days,
        argMax(dd, date) AS current_drawdown,
        sqrt(avg(dd * dd)) AS ulcer_index,
        avg(dd) AS avg_drawdown,
        countIf(dd < 0) / count() AS pct_time_underwater
    FROM with_recovery
    GROUP BY scheme_code, basis, period
    -- daily: the base NAV must be within 10 days of the window start (no stale price across a gap)
    -- monthly: every month of a fixed window present; SI needs >= 12 contiguous months
    HAVING (basis = 'daily' AND (period = 'SI' OR dateDiff('day', start_date, any(w_target)) <= 10))
        OR (basis = 'monthly' AND period = 'SI' AND n_obs >= 12
            AND n_obs = dateDiff('month', toStartOfMonth(min(date)), toStartOfMonth(max(date))) + 1)
        OR (basis = 'monthly' AND period != 'SI' AND n_obs = toUInt32(round(any(w_years) * 12)))
)
-- window functions over ~90M exploded rows: bound parallelism and spill sorts early so memory
-- stays ~1.4 GB (background refreshes don't pick up profile changes made after server start)
SETTINGS max_threads = 4, max_bytes_before_external_sort = 200000000, max_bytes_before_external_group_by = 200000000;

-- The five deepest drawdown episodes since inception (daily NAVs). An episode starts at an
-- all-time high and ends when the NAV first gets back to it.
CREATE TABLE IF NOT EXISTS fund_drawdowns
(
    scheme_code    UInt32,
    rank           UInt8,
    peak_date      Date,
    trough_date    Date,
    recovery_date  Nullable(Date),
    depth          Float64,
    decline_days   UInt32,
    recovery_days  Nullable(UInt32)
)
ENGINE = MergeTree
ORDER BY (scheme_code, rank);

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_drawdowns_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_drawdowns EMPTY AS
SELECT
    scheme_code,
    toUInt8(rn) AS rank,
    peak_date, trough_date, recovery_date, depth,
    toUInt32(dateDiff('day', peak_date, trough_date)) AS decline_days,
    toUInt32(dateDiff('day', trough_date, recovery_date)) AS recovery_days
FROM
(
    -- one row per episode: from a high until the NAV is back at or above it
    SELECT scheme_code, peak_date, min(dd) AS depth, argMin(date, dd) AS trough_date,
           nullIf(argMin(ifNull(next_peak_date, toDate(0)), dd), toDate(0)) AS recovery_date
    FROM
    (
        SELECT *, min(if(at_peak, date, NULL)) OVER (PARTITION BY scheme_code ORDER BY date DESC
                                                     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS next_peak_date
        FROM
        (
            SELECT scheme_code, date,
                   nav / max(nav) OVER w - 1 AS dd,
                   argMax(date, (nav, date)) OVER w AS peak_date,
                   peak_date = date AS at_peak
            FROM nav_clean
            WINDOW w AS (PARTITION BY scheme_code ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        )
    )
    GROUP BY scheme_code, peak_date
)
WHERE depth < 0
-- filter on the untruncated row number; casting first would wrap after 255 episodes
QUALIFY (row_number() OVER (PARTITION BY scheme_code ORDER BY depth ASC, peak_date) AS rn) <= 5
SETTINGS max_threads = 4, max_bytes_before_external_sort = 200000000, max_bytes_before_external_group_by = 200000000;

-- Benchmark-relative statistics per (basis, window, benchmark) for 1Y/3Y/5Y.
-- benchmark = 'category' (equal-weighted category index) or 'index' (AMFI tier-1 index proxy).
-- A row exists only when the benchmark covers every period of the window.
CREATE TABLE IF NOT EXISTS fund_relative
(
    scheme_code         UInt32,
    basis               LowCardinality(String),
    period              LowCardinality(String),
    benchmark           LowCardinality(String),
    n_obs               UInt32,
    periods_per_year    Float64,
    fund_cagr           Float64,
    benchmark_cagr      Float64,
    excess_cagr         Float64,
    beta                Nullable(Float64),
    alpha               Nullable(Float64),
    correlation         Nullable(Float64),
    r_squared           Nullable(Float64),
    tracking_error      Float64,
    information_ratio   Nullable(Float64),
    treynor             Nullable(Float64),
    m_squared           Nullable(Float64),
    up_capture          Nullable(Float64),
    down_capture        Nullable(Float64),
    capture_ratio       Nullable(Float64),
    batting_average     Float64,
    up_pct_ratio        Nullable(Float64),       -- share of up-benchmark periods the fund beat
    down_pct_ratio      Nullable(Float64)        -- share of down-benchmark periods the fund beat
)
ENGINE = MergeTree
ORDER BY (scheme_code, basis, period, benchmark);

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_relative_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_relative EMPTY AS
WITH
    windows AS
    (
        SELECT scheme_code, last_nav_date, inception_date,
               -- last complete month (see fund_monthly.is_complete)
               if(is_active AND toLastDayOfMonth(last_nav_date) <= as_of_date,
                  toStartOfMonth(last_nav_date), addMonths(toStartOfMonth(last_nav_date), -1)) AS last_month
        FROM scheme_info
        WHERE nav_count >= 2
    ),
    obs AS
    (
        SELECT d.scheme_code AS scheme_code, 'daily' AS basis, w.1 AS period, w.2 AS w_years,
               w.3 AS w_target, d.date AS date, d.prev_date AS prev_date,
               d.ret AS r, d.rf_ret AS rf, d.cat_ret AS cat, d.idx_ret AS idx
        FROM fund_daily AS d
        INNER JOIN windows AS i ON i.scheme_code = d.scheme_code
        ARRAY JOIN arrayFilter(x -> x.3 >= i.inception_date AND d.date > x.3, [
            ('1Y', 1., addYears(i.last_nav_date, -1)),
            ('3Y', 3., addYears(i.last_nav_date, -3)),
            ('5Y', 5., addYears(i.last_nav_date, -5))
        ]) AS w
        UNION ALL
        SELECT m.scheme_code, 'monthly', w.1, w.2, w.3, m.date, m.prev_date, m.ret, m.rf_ret, m.cat_ret, m.idx_ret
        FROM fund_monthly AS m
        INNER JOIN windows AS i ON i.scheme_code = m.scheme_code
        ARRAY JOIN arrayFilter(x -> m.month > x.3 AND m.month <= i.last_month, [
            ('1Y', 1., addMonths(i.last_month, -12)),
            ('3Y', 3., addMonths(i.last_month, -36)),
            ('5Y', 5., addMonths(i.last_month, -60))
        ]) AS w
        WHERE m.is_complete
    ),
    paired AS
    (
        -- one row per period per benchmark; bm stays NULL where the benchmark has no data
        SELECT scheme_code, basis, period, w_years, w_target, date, prev_date, r, rf, b.1 AS benchmark, b.2 AS bm
        FROM obs
        ARRAY JOIN [('category', cat), ('index', idx)] AS b
    ),
    stats AS
    (
        SELECT
            scheme_code, basis, period, benchmark,
            countIf(bm IS NULL) AS missing,
            count() AS n,
            any(w_years) AS yrs,
            if(basis = 'monthly', 12., n / yrs) AS ppy,
            sum(log1p(r)) AS log_growth_f,
            sum(log1p(bm)) AS log_growth_b,
            covarSamp(r - rf, bm - rf) AS cov_eb,
            varSamp(bm - rf) AS var_eb,
            avg(r - rf) AS mean_ef,
            avg(bm - rf) AS mean_eb,
            stddevSamp(r - rf) AS sd_ef,
            corr(r - rf, bm - rf) AS rho,
            stddevSamp(r - bm) AS sd_active,
            avg(r - bm) AS mean_active,
            stddevSamp(bm) AS sd_b,
            avg(rf) AS mean_rf,
            countIf(bm >= 0) AS n_up,
            countIf(bm < 0) AS n_down,
            sumIf(log1p(r), bm >= 0) AS lg_f_up,
            sumIf(log1p(bm), bm >= 0) AS lg_b_up,
            sumIf(log1p(r), bm < 0) AS lg_f_down,
            sumIf(log1p(bm), bm < 0) AS lg_b_down,
            countIf(r >= bm) AS n_beat_or_match,
            countIf(r > bm AND bm >= 0) AS n_beat_up,
            countIf(r > bm AND bm < 0) AS n_beat_down
        FROM paired
        GROUP BY scheme_code, basis, period, benchmark
        -- the benchmark must cover every period of the window; monthly windows need every month,
        -- daily windows a base NAV within 10 days of the window start
        HAVING missing = 0 AND n >= 2
           AND if(basis = 'monthly', n = toUInt64(round(yrs * 12)),
                  dateDiff('day', argMin(prev_date, date), any(w_target)) <= 10)
    )
SELECT
    scheme_code, basis, period, benchmark, n_obs, periods_per_year, fund_cagr, benchmark_cagr, excess_cagr,
    beta, alpha, correlation, r_squared, tracking_error, information_ratio, treynor, m_squared, up_capture,
    down_capture, capture_ratio, batting_average, up_pct_ratio, down_pct_ratio
FROM
(
    SELECT
        scheme_code, basis, period, benchmark,
        toUInt32(n) AS n_obs,
        ppy AS periods_per_year,
        exp(log_growth_f / yrs) - 1 AS fund_cagr,
        exp(log_growth_b / yrs) - 1 AS benchmark_cagr,
        fund_cagr - benchmark_cagr AS excess_cagr,
        if(var_eb > 0, cov_eb / var_eb, NULL) AS beta,
        (mean_ef - beta * mean_eb) * ppy AS alpha,
        rho AS correlation,
        rho * rho AS r_squared,
        assumeNotNull(sd_active) * sqrt(ppy) AS tracking_error,
        if(tracking_error > 0, mean_active * ppy / tracking_error, NULL) AS information_ratio,
        if(beta != 0, mean_ef * ppy / beta, NULL) AS treynor,
        if(sd_ef > 0, mean_ef / sd_ef * sd_b * ppy + mean_rf * ppy, NULL) AS m_squared,
        if(n_up > 0, exp(lg_f_up * ppy / n_up) - 1, NULL) AS fund_up,
        if(n_up > 0, exp(lg_b_up * ppy / n_up) - 1, NULL) AS bench_up,
        if(n_down > 0, exp(lg_f_down * ppy / n_down) - 1, NULL) AS fund_down,
        if(n_down > 0, exp(lg_b_down * ppy / n_down) - 1, NULL) AS bench_down,
        if(bench_up != 0, fund_up / bench_up, NULL) AS up_capture,
        if(bench_down != 0, fund_down / bench_down, NULL) AS down_capture,
        if(down_capture > 0, up_capture / down_capture, NULL) AS capture_ratio,
        n_beat_or_match / n AS batting_average,
        if(n_up > 0, n_beat_up / n_up, NULL) AS up_pct_ratio,
        if(n_down > 0, n_beat_down / n_down, NULL) AS down_pct_ratio
    FROM stats
)
SETTINGS max_threads = 4, max_bytes_before_external_sort = 200000000, max_bytes_before_external_group_by = 200000000;
