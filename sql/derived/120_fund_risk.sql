-- Absolute risk, return and drawdown statistics per (basis, window). VaR/CVaR are NULL for the
-- daily 10Y and SI windows.
-- basis = 'daily' (NAV-to-NAV returns) or 'monthly' (month-end returns, complete months only).
-- window = 1Y | 3Y | 5Y | 10Y | SI (SI only once there is at least a year of history).
CREATE OR REPLACE TABLE fund_risk
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
ORDER BY (scheme_code, basis, period)
AS
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
