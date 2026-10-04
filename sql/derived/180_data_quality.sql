-- Per-scheme data quality, exposed so the product can show how trustworthy each series is.
CREATE OR REPLACE TABLE data_quality
(
    scheme_code       UInt32,
    raw_dates         UInt64,
    clean_dates       UInt64,
    glitches_removed  UInt64,
    unit_changes      UInt64,
    first_date        Nullable(Date),
    last_date         Nullable(Date),
    max_gap_days      UInt16,
    gaps_over_7d      UInt64,
    gaps_over_30d     UInt64,
    largest_move      Nullable(Float64),
    largest_move_date Nullable(Date),
    moves_over_10pct  UInt64,
    idcw_events       UInt64,
    future_dated      UInt8,                   -- latest NAV dated after the market as-of date
    is_active         UInt8
)
ENGINE = MergeTree
ORDER BY scheme_code
AS
SELECT
    i.scheme_code AS scheme_code,
    ifNull(r.raw_dates, 0) AS raw_dates,
    ifNull(c.clean_dates, 0) AS clean_dates,
    ifNull(g.glitches, 0) AS glitches_removed,
    ifNull(u.unit_changes, 0) AS unit_changes,
    i.inception_date AS first_date,
    i.last_nav_date AS last_date,
    ifNull(c.max_gap, 0) AS max_gap_days,
    ifNull(c.gaps_7, 0) AS gaps_over_7d,
    ifNull(c.gaps_30, 0) AS gaps_over_30d,
    c.largest_move AS largest_move,
    c.largest_move_date AS largest_move_date,
    ifNull(c.big_moves, 0) AS moves_over_10pct,
    ifNull(e.events, 0) AS idcw_events,
    toUInt8(ifNull(i.last_nav_date > i.as_of_date, 0)) AS future_dated,
    i.is_active AS is_active
FROM scheme_info AS i
LEFT JOIN (SELECT scheme_code, count() AS raw_dates FROM nav FINAL GROUP BY scheme_code) AS r
    ON r.scheme_code = i.scheme_code
LEFT JOIN
(
    SELECT scheme_code, count() AS clean_dates, max(gap_days) AS max_gap,
           countIf(gap_days > 7) AS gaps_7, countIf(gap_days > 30) AS gaps_30,
           argMax(ret, abs(ret)) AS largest_move, argMax(date, abs(ret)) AS largest_move_date,
           countIf(abs(ret) > 0.10) AS big_moves
    FROM nav_clean
    GROUP BY scheme_code
) AS c ON c.scheme_code = i.scheme_code
LEFT JOIN (SELECT scheme_code, count() AS glitches FROM nav_glitches GROUP BY scheme_code) AS g
    ON g.scheme_code = i.scheme_code
LEFT JOIN (SELECT scheme_code, count() AS unit_changes FROM nav_adjustments GROUP BY scheme_code) AS u
    ON u.scheme_code = i.scheme_code
LEFT JOIN (SELECT scheme_code, count() AS events FROM idcw_events GROUP BY scheme_code) AS e
    ON e.scheme_code = i.scheme_code
SETTINGS join_use_nulls = 1
