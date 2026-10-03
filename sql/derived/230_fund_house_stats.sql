-- Fund house (AMC) scorecard: breadth plus how its ranked funds sit within their categories.
-- A plain view over scheme_info and the latest ranks (~38k rows), computed when queried.
CREATE OR REPLACE VIEW fund_house_stats SQL SECURITY INVOKER AS
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
SETTINGS join_use_nulls = 1
