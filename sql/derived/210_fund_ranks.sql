-- Peer ranks within category x plan (peer_eligible schemes), appended to the rank history table
-- (created by migration 0001). Re-running for the same as_of_date replaces that day's rows.
INSERT INTO fund_ranks
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

-- The latest day's ranks.
CREATE OR REPLACE VIEW fund_ranks_latest SQL SECURITY INVOKER AS
SELECT * EXCEPT computed_at
FROM fund_ranks FINAL
WHERE as_of_date = (SELECT max(as_of_date) FROM fund_ranks)
