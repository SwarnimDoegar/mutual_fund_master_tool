-- The five deepest drawdown episodes since inception (daily NAVs). An episode starts at an
-- all-time high and ends when the NAV first gets back to it.
CREATE OR REPLACE TABLE fund_drawdowns
(
    scheme_code    UInt32,
    rank           UInt8,
    peak_date      Date,
    trough_date    Date,
    recovery_date  Nullable(Date),
    depth          Float64,
    decline_days   UInt32,
    recovery_days  Nullable(UInt32)
)
ENGINE = MergeTree
ORDER BY (scheme_code, rank)
AS
SELECT
    scheme_code,
    toUInt8(rn) AS rank,
    peak_date, trough_date, recovery_date, depth,
    toUInt32(dateDiff('day', peak_date, trough_date)) AS decline_days,
    toUInt32(dateDiff('day', trough_date, recovery_date)) AS recovery_days
FROM
(
    -- one row per episode: from a high until the NAV is back at or above it
    SELECT scheme_code, peak_date, min(dd) AS depth, argMin(date, dd) AS trough_date,
           nullIf(argMin(ifNull(next_peak_date, toDate(0)), dd), toDate(0)) AS recovery_date
    FROM
    (
        SELECT *, min(if(at_peak, date, NULL)) OVER (PARTITION BY scheme_code ORDER BY date DESC
                                                     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS next_peak_date
        FROM
        (
            SELECT scheme_code, date,
                   nav / max(nav) OVER w - 1 AS dd,
                   argMax(date, (nav, date)) OVER w AS peak_date,
                   peak_date = date AS at_peak
            FROM nav_clean
            WINDOW w AS (PARTITION BY scheme_code ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        )
    )
    GROUP BY scheme_code, peak_date
)
WHERE depth < 0
-- filter on the untruncated row number; casting first would wrap after 255 episodes
QUALIFY (row_number() OVER (PARTITION BY scheme_code ORDER BY depth ASC, peak_date) AS rn) <= 5
