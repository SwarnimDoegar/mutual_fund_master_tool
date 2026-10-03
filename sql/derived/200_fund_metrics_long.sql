-- Rankable headline metrics in long form (a plain view over fund_metrics). higher_is_better
-- orients each metric (volatility and down-capture: lower is better; drawdowns are negative, so
-- higher is better).
CREATE OR REPLACE VIEW fund_metrics_long SQL SECURITY INVOKER AS
SELECT
    as_of_date, scheme_code, category, plan, peer_eligible,
    toLowCardinality(m.1) AS metric, assumeNotNull(m.2) AS value, m.3 AS higher_is_better
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
WHERE m.2 IS NOT NULL AND isFinite(assumeNotNull(m.2))
