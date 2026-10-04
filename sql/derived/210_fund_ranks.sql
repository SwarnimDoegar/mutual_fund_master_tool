-- Peer ranks within category x plan (peer_eligible schemes), appended to the rank history table
-- (created by migration 0001). Re-running for the same as_of_date replaces that day's rows.
-- Morningstar's method ("Percentile Ranks, Fractional Ranks and Absolute Ranks", 2008,
-- https://admainnew.morningstar.com/directhelp/Morningstar_Ranking_Methodologies.pdf):
--   rank:       absolute rank, 1 = best; tied funds share the better rank (competition ranking)
--   pct_rank:   distinct values are ranked i = 1..n (dense), pct_rank = 1 for i = 1, else
--               floor(99 (i - 1) / (n - 1) + 1): 1 = best, 100 = worst; funds that tie share it,
--               so funds tied for best are all 1
--   quartile:   1 for 0 < pct_rank <= 25, 2 for <= 50, 3 for <= 75, 4 for <= 100
--   percentile: the same scale turned round for display, 100 = best, 0 = worst
-- Rows written before this definition are kept as they are.
INSERT INTO fund_ranks
SELECT
    as_of_date, metric, scheme_code, category, plan, value, rank, peers,
    (100 - pct_rank) / 99 * 100 AS percentile,
    toUInt8(ceil(pct_rank / 25)) AS quartile,
    now64(3) AS computed_at
FROM
(
    SELECT
        *,
        if(drank = 1, 1., floor(99 * (drank - 1) / (n_distinct - 1) + 1)) AS pct_rank
    FROM
    (
        SELECT
            as_of_date, metric, scheme_code, category, plan, value,
            toUInt32(rank() OVER (PARTITION BY category, plan, metric ORDER BY score DESC)) AS rank,
            toUInt32(count() OVER (PARTITION BY category, plan, metric)) AS peers,
            toUInt32(dense_rank() OVER (PARTITION BY category, plan, metric ORDER BY score DESC)) AS drank,
            toUInt32(uniqExact(score) OVER (PARTITION BY category, plan, metric)) AS n_distinct
        FROM (SELECT *, if(higher_is_better, value, -value) AS score FROM fund_metrics_long WHERE peer_eligible)
    )
);

-- The latest day's ranks.
CREATE OR REPLACE VIEW fund_ranks_latest SQL SECURITY INVOKER AS
SELECT * EXCEPT computed_at
FROM fund_ranks FINAL
WHERE as_of_date = (SELECT max(as_of_date) FROM fund_ranks)
