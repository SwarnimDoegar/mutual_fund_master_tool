-- Distribution of each headline metric across a category's peer group. A plain view: it
-- aggregates a few thousand peer rows of fund_metrics_long, so it is computed when queried and is
-- always consistent with fund_metrics.
CREATE OR REPLACE VIEW category_stats SQL SECURITY INVOKER AS
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
GROUP BY category, plan, metric
