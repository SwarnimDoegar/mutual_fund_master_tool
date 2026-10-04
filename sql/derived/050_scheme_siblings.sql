-- Sibling share classes of the same scheme, matched on fund house + normalised name.
-- Only unambiguous one-to-one matches among recently active schemes are kept.
--   relation = 'regular' : sibling is the Regular plan of this Direct scheme (and 'direct' back)
--   relation = 'growth'  : sibling is the Growth option of this IDCW/Bonus scheme (same plan)
CREATE OR REPLACE TABLE scheme_siblings
(
    scheme_code  UInt32,
    relation     LowCardinality(String),
    sibling_code UInt32
)
ENGINE = MergeTree
ORDER BY (scheme_code, relation)
AS
WITH candidates AS
(
    SELECT * FROM scheme_info
    WHERE base_name != '' AND NOT is_legacy_plan AND last_nav_date >= as_of_date - 30
)
SELECT p.1 AS scheme_code, p.2 AS relation, p.3 AS sibling_code
FROM
(
    SELECT groupArrayIf(scheme_code, plan = 'Direct') AS d, groupArrayIf(scheme_code, plan = 'Regular') AS r
    FROM candidates
    GROUP BY fund_house, base_name, option, idcw_frequency
    HAVING length(d) = 1 AND length(r) = 1
)
ARRAY JOIN [(d[1], 'regular', r[1]), (r[1], 'direct', d[1])] AS p
UNION ALL
SELECT p.1, p.2, p.3
FROM
(
    SELECT groupArrayIf(scheme_code, option = 'Growth') AS g, groupArrayIf(scheme_code, option != 'Growth') AS others
    FROM candidates
    GROUP BY fund_house, base_name, plan
    HAVING length(g) = 1 AND length(others) >= 1
)
ARRAY JOIN arrayMap(o -> (o, 'growth', g[1]), others) AS p
