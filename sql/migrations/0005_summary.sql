-- Refreshable materialized views, part 4: one wide row of headline metrics per scheme (the
-- screener table), peer ranks with daily history, and category / fund-house rollups.
-- Detailed breakdowns live in the per-family tables (fund_returns, fund_risk, ...).

CREATE TABLE IF NOT EXISTS fund_metrics
(
    as_of_date                     Date,
    scheme_code                    UInt32,
    scheme_name                    String,
    fund_house                     LowCardinality(String),
    asset_class                    LowCardinality(String),
    category                       LowCardinality(String),
    plan                           LowCardinality(String),
    option                         LowCardinality(String),
    -- 'total' for Growth options; 'price' for IDCW/Bonus options, whose NAV returns exclude
    -- payouts and bonus units (use growth_option_code for their total-return figures)
    return_basis                   LowCardinality(String),
    idcw_frequency                 LowCardinality(String),
    scheme_type                    LowCardinality(String),
    is_active                      UInt8,
    peer_eligible                  UInt8,
    inception_date                 Nullable(Date),
    last_nav_date                  Nullable(Date),
    last_nav                       Nullable(Float64),
    age_years                      Nullable(Float64),
    -- trailing returns (absolute up to 1Y, CAGR beyond)
    ret_1d                         Nullable(Float64),
    ret_1w                         Nullable(Float64),
    ret_1m                         Nullable(Float64),
    ret_3m                         Nullable(Float64),
    ret_6m                         Nullable(Float64),
    ret_ytd                        Nullable(Float64),
    ret_fytd                       Nullable(Float64),
    ret_1y                         Nullable(Float64),
    cagr_2y                        Nullable(Float64),
    cagr_3y                        Nullable(Float64),
    cagr_5y                        Nullable(Float64),
    cagr_7y                        Nullable(Float64),
    cagr_10y                       Nullable(Float64),
    cagr_15y                       Nullable(Float64),
    cagr_20y                       Nullable(Float64),
    cagr_si                        Nullable(Float64),
    abs_return_si                  Nullable(Float64),
    -- NAV levels
    ath_nav                        Nullable(Float64),
    pct_below_ath                  Nullable(Float64),
    days_since_ath                 Nullable(UInt32),
    high_52w                       Nullable(Float64),
    low_52w                        Nullable(Float64),
    pct_below_52w_high             Nullable(Float64),
    pct_vs_sma_200                 Nullable(Float64),
    -- risk, daily basis
    volatility_1y                  Nullable(Float64),
    volatility_3y                  Nullable(Float64),
    volatility_5y                  Nullable(Float64),
    sharpe_1y                      Nullable(Float64),
    sharpe_3y                      Nullable(Float64),
    sharpe_5y                      Nullable(Float64),
    sortino_1y                     Nullable(Float64),
    sortino_3y                     Nullable(Float64),
    sortino_5y                     Nullable(Float64),
    calmar_3y                      Nullable(Float64),
    max_drawdown_1y                Nullable(Float64),
    max_drawdown_3y                Nullable(Float64),
    max_drawdown_5y                Nullable(Float64),
    max_drawdown_si                Nullable(Float64),
    mdd_si_peak_date               Nullable(Date),
    mdd_si_trough_date             Nullable(Date),
    mdd_si_recovery_date           Nullable(Date),
    current_drawdown               Nullable(Float64),
    ulcer_index_3y                 Nullable(Float64),
    var_95_1y                      Nullable(Float64),
    cvar_95_1y                     Nullable(Float64),
    skewness_3y                    Nullable(Float64),
    excess_kurtosis_3y             Nullable(Float64),
    -- risk, monthly basis (comparable with Morningstar / Value Research)
    volatility_3y_monthly          Nullable(Float64),
    sharpe_3y_monthly              Nullable(Float64),
    sortino_3y_monthly             Nullable(Float64),
    volatility_5y_monthly          Nullable(Float64),
    sharpe_5y_monthly              Nullable(Float64),
    -- relative to the category index (monthly basis, 3Y)
    beta_3y_category               Nullable(Float64),
    alpha_3y_category              Nullable(Float64),
    r_squared_3y_category          Nullable(Float64),
    tracking_error_3y_category     Nullable(Float64),
    information_ratio_3y_category  Nullable(Float64),
    up_capture_3y_category         Nullable(Float64),
    down_capture_3y_category       Nullable(Float64),
    batting_average_3y_category    Nullable(Float64),
    -- relative to the AMFI tier-1 index proxy (monthly basis, 3Y)
    benchmark_index                Nullable(String),
    beta_3y_index                  Nullable(Float64),
    alpha_3y_index                 Nullable(Float64),
    r_squared_3y_index             Nullable(Float64),
    tracking_error_3y_index        Nullable(Float64),
    information_ratio_3y_index     Nullable(Float64),
    up_capture_3y_index            Nullable(Float64),
    down_capture_3y_index          Nullable(Float64),
    excess_cagr_3y_index           Nullable(Float64),
    -- rolling returns
    rolling_1y_median              Nullable(Float64),
    rolling_1y_min                 Nullable(Float64),
    rolling_1y_pct_negative        Nullable(Float64),
    rolling_3y_median              Nullable(Float64),
    rolling_3y_min                 Nullable(Float64),
    rolling_3y_max                 Nullable(Float64),
    rolling_3y_pct_above_10        Nullable(Float64),
    rolling_3y_pct_beat_category   Nullable(Float64),
    rolling_5y_median              Nullable(Float64),
    rolling_5y_min                 Nullable(Float64),
    rolling_5y_pct_beat_category   Nullable(Float64),
    -- SIP XIRR
    sip_xirr_1y                    Nullable(Float64),
    sip_xirr_3y                    Nullable(Float64),
    sip_xirr_5y                    Nullable(Float64),
    sip_xirr_10y                   Nullable(Float64),
    sip_xirr_si                    Nullable(Float64),
    -- calendar statistics (complete periods only)
    best_month                     Nullable(Float64),
    worst_month                    Nullable(Float64),
    pct_positive_months            Nullable(Float64),
    longest_up_streak_months       Nullable(UInt32),
    longest_down_streak_months     Nullable(UInt32),
    best_calendar_year             Nullable(Float64),
    worst_calendar_year            Nullable(Float64),
    return_last_calendar_year      Nullable(Float64),
    -- share classes
    regular_plan_code              Nullable(UInt32),
    direct_plan_code               Nullable(UInt32),
    growth_option_code             Nullable(UInt32),
    direct_minus_regular_1y        Nullable(Float64),   -- set on Direct plans: implied cost gap
    direct_minus_regular_3y        Nullable(Float64),
    direct_minus_regular_5y        Nullable(Float64),
    -- IDCW payouts in the last year (IDCW plans), inferred from the Growth sibling
    idcw_payouts_1y                Nullable(UInt32),
    idcw_yield_1y                  Nullable(Float64),
    -- data quality
    glitches_removed               Nullable(UInt64),
    max_gap_days                   Nullable(UInt16)
)
ENGINE = MergeTree
ORDER BY scheme_code;

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_metrics_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_metrics EMPTY AS
WITH
    r AS
    (
        SELECT scheme_code,
            anyIf(toNullable(abs_return), horizon = '1D') AS ret_1d,
            anyIf(toNullable(abs_return), horizon = '1W') AS ret_1w,
            anyIf(toNullable(abs_return), horizon = '1M') AS ret_1m,
            anyIf(toNullable(abs_return), horizon = '3M') AS ret_3m,
            anyIf(toNullable(abs_return), horizon = '6M') AS ret_6m,
            anyIf(toNullable(abs_return), horizon = 'YTD') AS ret_ytd,
            anyIf(toNullable(abs_return), horizon = 'FYTD') AS ret_fytd,
            anyIf(toNullable(abs_return), horizon = '1Y') AS ret_1y,
            anyIf(cagr, horizon = '2Y') AS cagr_2y,
            anyIf(cagr, horizon = '3Y') AS cagr_3y,
            anyIf(cagr, horizon = '5Y') AS cagr_5y,
            anyIf(cagr, horizon = '7Y') AS cagr_7y,
            anyIf(cagr, horizon = '10Y') AS cagr_10y,
            anyIf(cagr, horizon = '15Y') AS cagr_15y,
            anyIf(cagr, horizon = '20Y') AS cagr_20y,
            anyIf(cagr, horizon = 'SI') AS cagr_si,
            anyIf(toNullable(abs_return), horizon = 'SI') AS abs_return_si
        FROM fund_returns
        GROUP BY scheme_code
    ),
    k AS
    (
        SELECT scheme_code,
            anyIf(toNullable(volatility), basis = 'daily' AND period = '1Y') AS volatility_1y,
            anyIf(toNullable(volatility), basis = 'daily' AND period = '3Y') AS volatility_3y,
            anyIf(toNullable(volatility), basis = 'daily' AND period = '5Y') AS volatility_5y,
            anyIf(sharpe, basis = 'daily' AND period = '1Y') AS sharpe_1y,
            anyIf(sharpe, basis = 'daily' AND period = '3Y') AS sharpe_3y,
            anyIf(sharpe, basis = 'daily' AND period = '5Y') AS sharpe_5y,
            anyIf(sortino, basis = 'daily' AND period = '1Y') AS sortino_1y,
            anyIf(sortino, basis = 'daily' AND period = '3Y') AS sortino_3y,
            anyIf(sortino, basis = 'daily' AND period = '5Y') AS sortino_5y,
            anyIf(calmar, basis = 'daily' AND period = '3Y') AS calmar_3y,
            anyIf(toNullable(max_drawdown), basis = 'daily' AND period = '1Y') AS max_drawdown_1y,
            anyIf(toNullable(max_drawdown), basis = 'daily' AND period = '3Y') AS max_drawdown_3y,
            anyIf(toNullable(max_drawdown), basis = 'daily' AND period = '5Y') AS max_drawdown_5y,
            anyIf(toNullable(max_drawdown), basis = 'daily' AND period = 'SI') AS max_drawdown_si,
            anyIf(toNullable(mdd_peak_date), basis = 'daily' AND period = 'SI') AS mdd_si_peak_date,
            anyIf(toNullable(mdd_trough_date), basis = 'daily' AND period = 'SI') AS mdd_si_trough_date,
            anyIf(mdd_recovery_date, basis = 'daily' AND period = 'SI') AS mdd_si_recovery_date,
            anyIf(toNullable(current_drawdown), basis = 'daily' AND period = 'SI') AS current_drawdown,
            anyIf(toNullable(ulcer_index), basis = 'daily' AND period = '3Y') AS ulcer_index_3y,
            anyIf(toNullable(var_95), basis = 'daily' AND period = '1Y') AS var_95_1y,
            anyIf(toNullable(cvar_95), basis = 'daily' AND period = '1Y') AS cvar_95_1y,
            anyIf(skewness, basis = 'daily' AND period = '3Y') AS skewness_3y,
            anyIf(excess_kurtosis, basis = 'daily' AND period = '3Y') AS excess_kurtosis_3y,
            anyIf(toNullable(volatility), basis = 'monthly' AND period = '3Y') AS volatility_3y_monthly,
            anyIf(sharpe, basis = 'monthly' AND period = '3Y') AS sharpe_3y_monthly,
            anyIf(sortino, basis = 'monthly' AND period = '3Y') AS sortino_3y_monthly,
            anyIf(toNullable(volatility), basis = 'monthly' AND period = '5Y') AS volatility_5y_monthly,
            anyIf(sharpe, basis = 'monthly' AND period = '5Y') AS sharpe_5y_monthly
        FROM fund_risk
        GROUP BY scheme_code
    ),
    rel AS
    (
        SELECT scheme_code,
            anyIf(beta, benchmark = 'category') AS beta_3y_category,
            anyIf(alpha, benchmark = 'category') AS alpha_3y_category,
            anyIf(r_squared, benchmark = 'category') AS r_squared_3y_category,
            anyIf(toNullable(tracking_error), benchmark = 'category') AS tracking_error_3y_category,
            anyIf(information_ratio, benchmark = 'category') AS information_ratio_3y_category,
            anyIf(up_capture, benchmark = 'category') AS up_capture_3y_category,
            anyIf(down_capture, benchmark = 'category') AS down_capture_3y_category,
            anyIf(toNullable(batting_average), benchmark = 'category') AS batting_average_3y_category,
            anyIf(beta, benchmark = 'index') AS beta_3y_index,
            anyIf(alpha, benchmark = 'index') AS alpha_3y_index,
            anyIf(r_squared, benchmark = 'index') AS r_squared_3y_index,
            anyIf(toNullable(tracking_error), benchmark = 'index') AS tracking_error_3y_index,
            anyIf(information_ratio, benchmark = 'index') AS information_ratio_3y_index,
            anyIf(up_capture, benchmark = 'index') AS up_capture_3y_index,
            anyIf(down_capture, benchmark = 'index') AS down_capture_3y_index,
            anyIf(toNullable(excess_cagr), benchmark = 'index') AS excess_cagr_3y_index
        FROM fund_relative
        WHERE basis = 'monthly' AND period = '3Y'
        GROUP BY scheme_code
    ),
    roll AS
    (
        SELECT scheme_code,
            anyIf(toNullable(median), period = '1Y') AS rolling_1y_median,
            anyIf(toNullable(min_return), period = '1Y') AS rolling_1y_min,
            anyIf(toNullable(pct_negative), period = '1Y') AS rolling_1y_pct_negative,
            anyIf(toNullable(median), period = '3Y') AS rolling_3y_median,
            anyIf(toNullable(min_return), period = '3Y') AS rolling_3y_min,
            anyIf(toNullable(max_return), period = '3Y') AS rolling_3y_max,
            anyIf(toNullable(pct_above_10), period = '3Y') AS rolling_3y_pct_above_10,
            anyIf(pct_beat_category, period = '3Y') AS rolling_3y_pct_beat_category,
            anyIf(toNullable(median), period = '5Y') AS rolling_5y_median,
            anyIf(toNullable(min_return), period = '5Y') AS rolling_5y_min,
            anyIf(pct_beat_category, period = '5Y') AS rolling_5y_pct_beat_category
        FROM fund_rolling
        GROUP BY scheme_code
    ),
    sip AS
    (
        SELECT scheme_code,
            anyIf(xirr, tenure = '1Y') AS sip_xirr_1y,
            anyIf(xirr, tenure = '3Y') AS sip_xirr_3y,
            anyIf(xirr, tenure = '5Y') AS sip_xirr_5y,
            anyIf(xirr, tenure = '10Y') AS sip_xirr_10y,
            anyIf(xirr, tenure = 'SI') AS sip_xirr_si
        FROM fund_sip
        GROUP BY scheme_code
    ),
    cal AS
    (
        SELECT scheme_code,
            maxIf(toNullable(ret), period_type = 'month') AS best_month,
            minIf(toNullable(ret), period_type = 'month') AS worst_month,
            countIf(period_type = 'month' AND ret > 0) / nullIf(countIf(period_type = 'month'), 0) AS pct_positive_months,
            maxIf(toNullable(ret), period_type = 'year') AS best_calendar_year,
            minIf(toNullable(ret), period_type = 'year') AS worst_calendar_year,
            argMaxIf(toNullable(ret), period_start, period_type = 'year') AS return_last_calendar_year,
            -- longest runs of consecutive positive / negative months
            arraySort(x -> x.1, groupArrayIf((period_start, ret), period_type = 'month')) AS months,
            arrayMap(x -> x.2, months) AS mrets,
            -- a run breaks when the sign changes or a month is missing
            arrayMap((m, i) -> i = 1 OR (m.2 > 0) != (months[i - 1].2 > 0) OR (m.2 < 0) != (months[i - 1].2 < 0)
                                OR m.1 != addMonths(months[i - 1].1, 1),
                     months, arrayEnumerate(months)) AS breaks,
            arraySplit((x, b) -> b, mrets, breaks) AS runs,
            if(length(mrets) > 0, toUInt32(arrayMax(arrayMap(c -> if(c[1] > 0, length(c), 0), runs))), NULL) AS longest_up_streak_months,
            if(length(mrets) > 0, toUInt32(arrayMax(arrayMap(c -> if(c[1] < 0, length(c), 0), runs))), NULL) AS longest_down_streak_months
        FROM fund_period_returns
        WHERE NOT is_partial
        GROUP BY scheme_code
    ),
    sib AS
    (
        SELECT scheme_code,
            anyIf(toNullable(sibling_code), relation = 'regular') AS regular_plan_code,
            anyIf(toNullable(sibling_code), relation = 'direct') AS direct_plan_code,
            anyIf(toNullable(sibling_code), relation = 'growth') AS growth_option_code
        FROM scheme_siblings
        GROUP BY scheme_code
    ),
    payouts AS
    (
        -- trailing-twelve-month distribution yield: payouts per unit over the current NAV
        SELECT e.scheme_code AS scheme_code, toUInt32(count()) AS idcw_payouts_1y,
               sum(e.payout_per_unit) / any(assumeNotNull(i.last_nav)) AS idcw_yield_1y
        FROM idcw_events AS e
        INNER JOIN scheme_info AS i ON i.scheme_code = e.scheme_code
        WHERE e.date > addYears(i.last_nav_date, -1)
        GROUP BY scheme_code
    )
SELECT
    i.as_of_date AS as_of_date,
    i.scheme_code AS scheme_code, i.scheme_name AS scheme_name, i.fund_house AS fund_house,
    i.asset_class AS asset_class, i.category AS category, i.plan AS plan, i.option AS option,
    if(i.option = 'Growth', 'total', 'price') AS return_basis,
    i.idcw_frequency AS idcw_frequency, i.scheme_type AS scheme_type,
    i.is_active AS is_active, i.peer_eligible AS peer_eligible,
    i.inception_date AS inception_date, i.last_nav_date AS last_nav_date, i.last_nav AS last_nav,
    dateDiff('day', i.inception_date, i.last_nav_date) / 365.25 AS age_years,
    r.ret_1d AS ret_1d, r.ret_1w AS ret_1w, r.ret_1m AS ret_1m, r.ret_3m AS ret_3m, r.ret_6m AS ret_6m, r.ret_ytd AS ret_ytd, r.ret_fytd AS ret_fytd, r.ret_1y AS ret_1y,
    r.cagr_2y AS cagr_2y, r.cagr_3y AS cagr_3y, r.cagr_5y AS cagr_5y, r.cagr_7y AS cagr_7y, r.cagr_10y AS cagr_10y, r.cagr_15y AS cagr_15y, r.cagr_20y AS cagr_20y, r.cagr_si AS cagr_si, r.abs_return_si AS abs_return_si,
    p.ath_nav AS ath_nav, p.pct_below_ath AS pct_below_ath, p.days_since_ath AS days_since_ath,
    p.high_52w AS high_52w, p.low_52w AS low_52w, p.pct_below_52w_high AS pct_below_52w_high,
    p.pct_vs_sma_200 AS pct_vs_sma_200,
    k.volatility_1y AS volatility_1y, k.volatility_3y AS volatility_3y, k.volatility_5y AS volatility_5y, k.sharpe_1y AS sharpe_1y, k.sharpe_3y AS sharpe_3y, k.sharpe_5y AS sharpe_5y,
    k.sortino_1y AS sortino_1y, k.sortino_3y AS sortino_3y, k.sortino_5y AS sortino_5y, k.calmar_3y AS calmar_3y,
    k.max_drawdown_1y AS max_drawdown_1y, k.max_drawdown_3y AS max_drawdown_3y, k.max_drawdown_5y AS max_drawdown_5y, k.max_drawdown_si AS max_drawdown_si,
    k.mdd_si_peak_date AS mdd_si_peak_date, k.mdd_si_trough_date AS mdd_si_trough_date, k.mdd_si_recovery_date AS mdd_si_recovery_date, k.current_drawdown AS current_drawdown,
    k.ulcer_index_3y AS ulcer_index_3y, k.var_95_1y AS var_95_1y, k.cvar_95_1y AS cvar_95_1y, k.skewness_3y AS skewness_3y, k.excess_kurtosis_3y AS excess_kurtosis_3y,
    k.volatility_3y_monthly AS volatility_3y_monthly, k.sharpe_3y_monthly AS sharpe_3y_monthly, k.sortino_3y_monthly AS sortino_3y_monthly, k.volatility_5y_monthly AS volatility_5y_monthly, k.sharpe_5y_monthly AS sharpe_5y_monthly,
    rel.beta_3y_category AS beta_3y_category, rel.alpha_3y_category AS alpha_3y_category, rel.r_squared_3y_category AS r_squared_3y_category, rel.tracking_error_3y_category AS tracking_error_3y_category,
    rel.information_ratio_3y_category AS information_ratio_3y_category, rel.up_capture_3y_category AS up_capture_3y_category, rel.down_capture_3y_category AS down_capture_3y_category,
    rel.batting_average_3y_category AS batting_average_3y_category,
    bp.index_name AS benchmark_index,
    rel.beta_3y_index AS beta_3y_index, rel.alpha_3y_index AS alpha_3y_index, rel.r_squared_3y_index AS r_squared_3y_index, rel.tracking_error_3y_index AS tracking_error_3y_index,
    rel.information_ratio_3y_index AS information_ratio_3y_index, rel.up_capture_3y_index AS up_capture_3y_index, rel.down_capture_3y_index AS down_capture_3y_index, rel.excess_cagr_3y_index AS excess_cagr_3y_index,
    roll.rolling_1y_median AS rolling_1y_median, roll.rolling_1y_min AS rolling_1y_min, roll.rolling_1y_pct_negative AS rolling_1y_pct_negative,
    roll.rolling_3y_median AS rolling_3y_median, roll.rolling_3y_min AS rolling_3y_min, roll.rolling_3y_max AS rolling_3y_max, roll.rolling_3y_pct_above_10 AS rolling_3y_pct_above_10,
    roll.rolling_3y_pct_beat_category AS rolling_3y_pct_beat_category, roll.rolling_5y_median AS rolling_5y_median, roll.rolling_5y_min AS rolling_5y_min, roll.rolling_5y_pct_beat_category AS rolling_5y_pct_beat_category,
    sip.sip_xirr_1y AS sip_xirr_1y, sip.sip_xirr_3y AS sip_xirr_3y, sip.sip_xirr_5y AS sip_xirr_5y, sip.sip_xirr_10y AS sip_xirr_10y, sip.sip_xirr_si AS sip_xirr_si,
    cal.best_month AS best_month, cal.worst_month AS worst_month, cal.pct_positive_months AS pct_positive_months, cal.longest_up_streak_months AS longest_up_streak_months,
    cal.longest_down_streak_months AS longest_down_streak_months, cal.best_calendar_year AS best_calendar_year, cal.worst_calendar_year AS worst_calendar_year, cal.return_last_calendar_year AS return_last_calendar_year,
    sib.regular_plan_code AS regular_plan_code, sib.direct_plan_code AS direct_plan_code, sib.growth_option_code AS growth_option_code,
    if(i.plan = 'Direct', r.ret_1y - rr.ret_1y, NULL) AS direct_minus_regular_1y,
    if(i.plan = 'Direct', r.cagr_3y - rr.cagr_3y, NULL) AS direct_minus_regular_3y,
    if(i.plan = 'Direct', r.cagr_5y - rr.cagr_5y, NULL) AS direct_minus_regular_5y,
    payouts.idcw_payouts_1y AS idcw_payouts_1y, payouts.idcw_yield_1y AS idcw_yield_1y,
    q.glitches_removed AS glitches_removed, q.max_gap_days AS max_gap_days
FROM scheme_info AS i
LEFT JOIN r ON r.scheme_code = i.scheme_code
LEFT JOIN fund_price_stats AS p ON p.scheme_code = i.scheme_code
LEFT JOIN k ON k.scheme_code = i.scheme_code
LEFT JOIN rel ON rel.scheme_code = i.scheme_code
LEFT JOIN benchmark_proxy AS bp ON bp.category = i.category
LEFT JOIN roll ON roll.scheme_code = i.scheme_code
LEFT JOIN sip ON sip.scheme_code = i.scheme_code
LEFT JOIN cal ON cal.scheme_code = i.scheme_code
LEFT JOIN sib ON sib.scheme_code = i.scheme_code
LEFT JOIN r AS rr ON rr.scheme_code = sib.regular_plan_code
LEFT JOIN payouts ON payouts.scheme_code = i.scheme_code
LEFT JOIN data_quality AS q ON q.scheme_code = i.scheme_code
SETTINGS join_use_nulls = 1;

-- Rankable headline metrics in long form. higher_is_better orients each metric (volatility and
-- down-capture: lower is better; drawdowns are negative, so higher is better).
CREATE VIEW IF NOT EXISTS fund_metrics_long AS
SELECT
    as_of_date, scheme_code, category, plan, peer_eligible,
    m.1 AS metric, assumeNotNull(m.2) AS value, m.3 AS higher_is_better
FROM fund_metrics
ARRAY JOIN [
    ('ret_1m', ret_1m, 1), ('ret_3m', ret_3m, 1), ('ret_6m', ret_6m, 1), ('ret_ytd', ret_ytd, 1),
    ('ret_1y', ret_1y, 1), ('cagr_3y', cagr_3y, 1), ('cagr_5y', cagr_5y, 1), ('cagr_10y', cagr_10y, 1),
    ('volatility_3y', volatility_3y, 0), ('sharpe_3y', sharpe_3y, 1), ('sortino_3y', sortino_3y, 1),
    ('max_drawdown_3y', max_drawdown_3y, 1), ('calmar_3y', calmar_3y, 1),
    ('sharpe_3y_monthly', sharpe_3y_monthly, 1),
    ('alpha_3y_category', alpha_3y_category, 1), ('information_ratio_3y_category', information_ratio_3y_category, 1),
    ('down_capture_3y_category', down_capture_3y_category, 0),
    ('rolling_3y_median', rolling_3y_median, 1), ('rolling_3y_pct_beat_category', rolling_3y_pct_beat_category, 1),
    ('sip_xirr_3y', sip_xirr_3y, 1), ('sip_xirr_5y', sip_xirr_5y, 1)
] AS m
WHERE m.2 IS NOT NULL AND isFinite(assumeNotNull(m.2));

-- Peer ranks within category x plan (peer_eligible schemes), appended every run so rank history
-- is kept. Re-running for the same as_of_date replaces that day's rows (ReplacingMergeTree).
-- rank 1 = best; percentile 100 = best; quartile 1 = top.
CREATE TABLE IF NOT EXISTS fund_ranks
(
    as_of_date  Date,
    metric      LowCardinality(String),
    scheme_code UInt32,
    category    LowCardinality(String),
    plan        LowCardinality(String),
    value       Float64,
    rank        UInt32,
    peers       UInt32,
    percentile  Float64,
    quartile    UInt8,
    computed_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(computed_at)
ORDER BY (as_of_date, metric, scheme_code);

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_ranks_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
APPEND TO fund_ranks EMPTY AS
SELECT
    as_of_date, metric, scheme_code, category, plan, value,
    toUInt32(rank() OVER (PARTITION BY category, plan, metric
                          ORDER BY if(higher_is_better, value, -value) DESC)) AS rank,
    toUInt32(count() OVER (PARTITION BY category, plan, metric)) AS peers,
    if(peers > 1, (peers - rank) / (peers - 1) * 100, 100.) AS percentile,
    toUInt8(ceil(4 * rank / peers)) AS quartile,
    now64(3) AS computed_at
FROM fund_metrics_long
WHERE peer_eligible;

CREATE VIEW IF NOT EXISTS fund_ranks_latest AS
SELECT * EXCEPT computed_at
FROM fund_ranks FINAL
WHERE as_of_date = (SELECT max(as_of_date) FROM fund_ranks);

-- Distribution of each headline metric across a category's peer group.
CREATE TABLE IF NOT EXISTS category_stats
(
    as_of_date        Date,
    category          LowCardinality(String),
    plan              LowCardinality(String),
    metric            LowCardinality(String),
    n_funds           UInt32,
    mean              Float64,
    median            Float64,
    p25               Float64,
    p75               Float64,
    min_value         Float64,
    max_value         Float64,
    stddev            Float64,
    best_scheme_code  UInt32,
    worst_scheme_code UInt32
)
ENGINE = MergeTree
ORDER BY (category, plan, metric);

CREATE MATERIALIZED VIEW IF NOT EXISTS category_stats_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO category_stats EMPTY AS
SELECT
    any(as_of_date) AS as_of_date, category, plan, metric,
    toUInt32(count()) AS n_funds,
    avg(value) AS mean,
    quantileExactInclusive(0.5)(value) AS median,
    quantileExactInclusive(0.25)(value) AS p25,
    quantileExactInclusive(0.75)(value) AS p75,
    min(value) AS min_value,
    max(value) AS max_value,
    stddevSamp(value) AS stddev,
    argMax(scheme_code, if(higher_is_better, value, -value)) AS best_scheme_code,
    argMin(scheme_code, if(higher_is_better, value, -value)) AS worst_scheme_code
FROM fund_metrics_long
WHERE peer_eligible
GROUP BY category, plan, metric;

-- Fund house (AMC) scorecard: breadth plus how its ranked funds sit within their categories.
CREATE TABLE IF NOT EXISTS fund_house_stats
(
    as_of_date                Date,
    fund_house                LowCardinality(String),
    schemes                   UInt32,
    active_schemes            UInt32,
    ranked_funds              UInt32,
    categories                UInt32,
    avg_percentile_cagr_3y    Nullable(Float64),
    pct_top_quartile_cagr_3y  Nullable(Float64),
    avg_percentile_sharpe_3y  Nullable(Float64),
    avg_percentile_rolling_3y Nullable(Float64),
    first_nav_date            Nullable(Date)
)
ENGINE = MergeTree
ORDER BY fund_house;

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_house_stats_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_house_stats EMPTY AS
SELECT
    any(i.as_of_date) AS as_of_date,
    i.fund_house AS fund_house,
    toUInt32(count()) AS schemes,
    toUInt32(countIf(i.is_active)) AS active_schemes,
    toUInt32(countIf(i.peer_eligible)) AS ranked_funds,
    toUInt32(uniqExactIf(i.category, i.peer_eligible)) AS categories,
    avgIf(rk.pct_cagr, rk.pct_cagr IS NOT NULL) AS avg_percentile_cagr_3y,
    countIf(rk.q_cagr = 1) / nullIf(countIf(rk.q_cagr IS NOT NULL), 0) AS pct_top_quartile_cagr_3y,
    avgIf(rk.pct_sharpe, rk.pct_sharpe IS NOT NULL) AS avg_percentile_sharpe_3y,
    avgIf(rk.pct_roll, rk.pct_roll IS NOT NULL) AS avg_percentile_rolling_3y,
    min(i.inception_date) AS first_nav_date
FROM scheme_info AS i
LEFT JOIN
(
    SELECT scheme_code,
        anyIf(toNullable(percentile), metric = 'cagr_3y') AS pct_cagr,
        anyIf(toNullable(quartile), metric = 'cagr_3y') AS q_cagr,
        anyIf(toNullable(percentile), metric = 'sharpe_3y') AS pct_sharpe,
        anyIf(toNullable(percentile), metric = 'rolling_3y_median') AS pct_roll
    FROM fund_ranks_latest
    GROUP BY scheme_code
) AS rk ON rk.scheme_code = i.scheme_code
WHERE i.fund_house != ''
GROUP BY i.fund_house
SETTINGS join_use_nulls = 1;
