-- Single-day NAV spikes that the next NAV reverses (data-entry errors). Excluded from analytics,
-- kept in the raw `nav` table and listed here for auditing.
CREATE OR REPLACE TABLE nav_glitches
(
    scheme_code UInt32,
    date        Date,
    nav         Float64,
    prev_nav    Float64,
    next_nav    Float64,
    move        Float64
)
ENGINE = MergeTree
ORDER BY (scheme_code, date)
AS
WITH
    (SELECT any(value) FROM settings WHERE key = 'glitch_min_move') AS min_move,
    (SELECT any(value) FROM settings WHERE key = 'glitch_max_reversal') AS max_reversal
SELECT scheme_code, date, nav, prev_nav, next_nav, nav / prev_nav - 1 AS move
FROM
(
    SELECT
        scheme_code, date, nav,
        lagInFrame(nav, 1, 0.) OVER w AS prev_nav,
        leadInFrame(nav, 1, 0.) OVER w AS next_nav
    FROM nav FINAL
    WINDOW w AS (PARTITION BY scheme_code ORDER BY date ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING)
)
WHERE prev_nav > 0 AND next_nav > 0
  AND abs(nav / prev_nav - 1) >= min_move
  AND abs(next_nav / prev_nav - 1) <= max_reversal
