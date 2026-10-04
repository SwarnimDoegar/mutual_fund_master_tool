-- Peer ranks within category x plan (peer_eligible schemes), appended to the rank history table
-- (created by migration 0001). Re-running for the same as_of_date replaces that day's rows.
--   rank:       competition rank, 1 = best (ties share the better rank)
--   percentile: share of the other peers this fund strictly beats, 0-100 (100 = best); a tied
--               fund gets no credit for the funds it ties with
--   quartile:   Morningstar's percentile rank runs from 1 (best) to 100 (worst) and quartile N
--               covers ranks 25(N-1)+1 .. 25N, i.e. quartile = ceil(percentile rank / 25), with
--               the best fund always in Q1 ("Absolute Ranks, Percentile Ranks, and Fractional
--               Ranks", https://morningstardirect.morningstar.com/clientcomm/Morningstar_Methodology_Ranking_Calculations.pdf;
--               https://awgmain.morningstar.com/webhelp/glossary_definitions/mutual_fund/Percentile_Rank_in_Category.htm).
--               Here the percentile rank is 100 - percentile, so quartile = ceil(4 x share of
--               other peers not beaten), at least 1.
-- Rows written before this definition (ceil(4 x rank / peers), ties credited) are kept as they are.
INSERT INTO fund_ranks
SELECT
    as_of_date, metric, scheme_code, category, plan, value, rank, peers,
    if(peers > 1, beaten / (peers - 1) * 100, 100.) AS percentile,
    toUInt8(if(peers > 1, greatest(1, ceil(4 * (peers - 1 - beaten) / (peers - 1))), 1)) AS quartile,
    now64(3) AS computed_at
FROM
(
    SELECT
        as_of_date, metric, scheme_code, category, plan, value,
        toUInt32(rank() OVER (PARTITION BY category, plan, metric ORDER BY score DESC)) AS rank,
        toUInt32(count() OVER (PARTITION BY category, plan, metric)) AS peers,
        -- peers strictly worse: all peers, minus those ranked better, minus the tie group (incl. itself)
        toInt64(peers) - (rank - 1) - toInt64(count() OVER (PARTITION BY category, plan, metric, score)) AS beaten
    FROM (SELECT *, if(higher_is_better, value, -value) AS score FROM fund_metrics_long WHERE peer_eligible)
);

-- The latest day's ranks.
CREATE OR REPLACE VIEW fund_ranks_latest SQL SECURITY INVOKER AS
SELECT * EXCEPT computed_at
FROM fund_ranks FINAL
WHERE as_of_date = (SELECT max(as_of_date) FROM fund_ranks)
