-- Refreshable materialized views, part 3: rolling returns, SIP returns, IDCW payouts and data
-- quality. Scheduling as described in 0002.

-- Rolling returns: for every NAV date t with enough history, the annualised return from the
-- nearest NAV on or before t minus N years (within 10 days). Summarised as a distribution per window, compared
-- with the category index's rolling return over exactly the same dates.
CREATE TABLE IF NOT EXISTS fund_rolling
(
    scheme_code       UInt32,
    period            LowCardinality(String),   -- 1Y | 3Y | 5Y | 10Y
    years             UInt8,
    n_periods         UInt32,
    first_end_date    Date,
    last_end_date     Date,
    min_return        Float64,
    p05               Float64,
    p25               Float64,
    median            Float64,
    p75               Float64,
    p95               Float64,
    max_return        Float64,
    mean_return       Float64,
    stddev            Float64,
    latest_return     Float64,
    pct_negative      Float64,
    pct_above_7       Float64,
    pct_above_10      Float64,
    pct_above_12      Float64,
    pct_above_15      Float64,
    category_median   Nullable(Float64),
    pct_beat_category Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (scheme_code, period);

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_rolling_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_rolling EMPTY AS
SELECT
    scheme_code, period, years, n_periods, first_end_date, last_end_date, min_return,
    q[1] AS p05, q[2] AS p25, q[3] AS median, q[4] AS p75, q[5] AS p95,
    max_return, mean_return, stddev, latest_return, pct_negative, pct_above_7, pct_above_10,
    pct_above_12, pct_above_15, category_median, pct_beat_category
FROM
(
    SELECT
        scheme_code,
        concat(toString(y), 'Y') AS period,
        toUInt8(y) AS years,
        toUInt32(count()) AS n_periods,
        min(date) AS first_end_date,
        max(date) AS last_end_date,
        min(rr) AS min_return,
        -- one combined state: separate quantile functions would each keep a copy of the values
        quantilesExactInclusive(0.05, 0.25, 0.5, 0.75, 0.95)(rr) AS q,
        max(rr) AS max_return,
        avg(rr) AS mean_return,
        stddevSamp(rr) AS stddev,
        argMax(rr, date) AS latest_return,
        countIf(rr < 0) / count() AS pct_negative,
        countIf(rr > 0.07) / count() AS pct_above_7,
        countIf(rr > 0.10) / count() AS pct_above_10,
        countIf(rr > 0.12) / count() AS pct_above_12,
        countIf(rr > 0.15) / count() AS pct_above_15,
        if(count(cr) = count(), quantileExactInclusive(0.5)(cr), NULL) AS category_median,
        if(count(cr) = count(), countIf(rr > cr) / count(), NULL) AS pct_beat_category
    FROM
    (
        SELECT
            r.scheme_code AS scheme_code, r.y AS y, r.date AS date,
            pow(r.nav / r.start_nav, 1 / r.y) - 1 AS rr,
            -- category over the same two dates as the fund
            pow(c1.level / c0.level, 1 / r.y) - 1 AS cr
        FROM
        (
            SELECT scheme_code, date, nav, cat_key, w.1 AS y, w.2 AS start_nav, w.3 AS start_date
            FROM
            (
                -- The start NAV for t is the last NAV on or before t minus N years. With
                -- k = year*372 + (month-1)*31 + (day-1), "N years earlier" is exactly k - 372*N
                -- (Feb 29 falls back to Feb 28, as addYears does), so it is a RANGE frame ending
                -- 372*N before the current row: one sorted pass instead of an ASOF join.
                SELECT
                    n.scheme_code AS scheme_code, n.date AS date, n.nav AS nav,
                    concat('cat|', i.category, '|', i.plan) AS cat_key,
                    toYear(n.date) * 372 + (toMonth(n.date) - 1) * 31 + (toDayOfMonth(n.date) - 1) AS k,
                    last_value(n.nav) OVER w1 AS nav1, last_value(n.date) OVER w1 AS date1,
                    last_value(n.nav) OVER w3 AS nav3, last_value(n.date) OVER w3 AS date3,
                    last_value(n.nav) OVER w5 AS nav5, last_value(n.date) OVER w5 AS date5,
                    last_value(n.nav) OVER w10 AS nav10, last_value(n.date) OVER w10 AS date10
                FROM nav_clean AS n
                INNER JOIN scheme_info AS i ON i.scheme_code = n.scheme_code
                WINDOW
                    w1 AS (PARTITION BY n.scheme_code ORDER BY k RANGE BETWEEN UNBOUNDED PRECEDING AND 372 PRECEDING),
                    w3 AS (PARTITION BY n.scheme_code ORDER BY k RANGE BETWEEN UNBOUNDED PRECEDING AND 1116 PRECEDING),
                    w5 AS (PARTITION BY n.scheme_code ORDER BY k RANGE BETWEEN UNBOUNDED PRECEDING AND 1860 PRECEDING),
                    w10 AS (PARTITION BY n.scheme_code ORDER BY k RANGE BETWEEN UNBOUNDED PRECEDING AND 3720 PRECEDING)
            )
            ARRAY JOIN [(1, nav1, date1), (3, nav3, date3), (5, nav5, date5), (10, nav10, date10)] AS w
            -- a start NAV must exist and be within 10 days of the target date
            WHERE w.2 > 0 AND dateDiff('day', w.3, addYears(date, -toInt32(w.1))) <= 10
        ) AS r
        LEFT JOIN benchmark_daily AS c1 ON c1.bench_key = r.cat_key AND c1.date = r.date
        LEFT JOIN benchmark_daily AS c0 ON c0.bench_key = r.cat_key AND c0.date = r.start_date
    )
    GROUP BY scheme_code, y
)
SETTINGS join_use_nulls = 1, max_threads = 4, max_bytes_before_external_sort = 200000000, max_bytes_before_external_group_by = 200000000;

-- SIP returns: a fixed monthly installment (settings.sip_monthly_amount) on the first NAV date of
-- each month, valued at the latest NAV. Tenures cover the N whole months before the current
-- month; SI starts at the first month with a NAV. XIRR uses ClickHouse's native
-- financialInternalRateOfReturnExtended (ACT/365F, same as Excel's XIRR).
CREATE TABLE IF NOT EXISTS fund_sip
(
    scheme_code       UInt32,
    tenure            LowCardinality(String),
    tenure_order      UInt8,
    installments      UInt16,
    first_installment Date,
    last_installment  Date,
    amount            Float64,
    invested          Float64,
    units             Float64,
    value_date        Date,
    current_value     Float64,
    gain              Float64,
    abs_return        Float64,
    xirr              Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (scheme_code, tenure_order);

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_sip_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_sip EMPTY AS
WITH ifNull((SELECT any(value) FROM settings WHERE key = 'sip_monthly_amount'), 0.) AS sip_amount
SELECT
    scheme_code, tenure, tenure_order, installments, first_installment, last_installment, amount, invested,
    units, value_date, current_value, gain, abs_return, xirr
FROM
(
    SELECT
        m.scheme_code AS scheme_code,
        t.1 AS tenure,
        t.2 AS tenure_order,
        if(t.3 > 0, addMonths(toStartOfMonth(i.last_nav_date), -t.3), m.months[1].1) AS start_month,
        arrayFilter(x -> x.1 >= start_month AND x.1 < toStartOfMonth(i.last_nav_date), m.months) AS inst,
        toUInt16(length(inst)) AS installments,
        inst[1].2 AS first_installment,
        inst[-1].2 AS last_installment,
        sip_amount AS amount,
        sip_amount * length(inst) AS invested,
        arraySum(x -> sip_amount / x.3, inst) AS units,
        assumeNotNull(i.last_nav_date) AS value_date,
        units * assumeNotNull(i.last_nav) AS current_value,
        current_value - invested AS gain,
        current_value / invested - 1 AS abs_return,
        financialInternalRateOfReturnExtended(
            arrayConcat(arrayMap(x -> -sip_amount, inst), [current_value]),
            arrayConcat(arrayMap(x -> x.2, inst), [assumeNotNull(i.last_nav_date)])) AS irr,
        if(length(inst) >= 12 AND isFinite(irr), irr, NULL) AS xirr
    FROM
    (
        SELECT scheme_code, arraySort(x -> x.1, groupArray((month, first_date, first_nav))) AS months
        FROM
        (
            SELECT scheme_code, toStartOfMonth(date) AS month, min(date) AS first_date, argMin(nav, date) AS first_nav
            FROM nav_clean
            GROUP BY scheme_code, month
        )
        GROUP BY scheme_code
    ) AS m
    INNER JOIN scheme_info AS i ON i.scheme_code = m.scheme_code
    ARRAY JOIN [('1Y', 1, 12), ('3Y', 2, 36), ('5Y', 3, 60), ('7Y', 4, 84), ('10Y', 5, 120), ('15Y', 6, 180), ('SI', 7, 0)] AS t
    WHERE length(inst) >= 1
      AND (
            -- fixed tenures: every month present, first installment in the first week of the month
            (t.3 > 0 AND length(inst) = t.3 AND inst[1].1 = start_month AND dateDiff('day', start_month, inst[1].2) <= 7)
            OR t.3 = 0
          )
);

-- IDCW payouts inferred from NAVs: on a payout date an IDCW plan's NAV falls by the payout
-- while its Growth sibling (same scheme, same plan) does not. payout_per_unit is the gap
-- between the IDCW NAV and where it would be had it moved with the Growth option.
CREATE TABLE IF NOT EXISTS idcw_events
(
    scheme_code     UInt32,
    date            Date,
    growth_code     UInt32,
    idcw_ret        Float64,
    growth_ret      Float64,
    payout_per_unit Float64,
    payout_pct      Float64
)
ENGINE = MergeTree
ORDER BY (scheme_code, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS idcw_events_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO idcw_events EMPTY AS
WITH (SELECT any(value) FROM settings WHERE key = 'idcw_min_gap') AS min_gap
SELECT
    d.scheme_code AS scheme_code,
    d.date AS date,
    s.sibling_code AS growth_code,
    d.ret AS idcw_ret,
    g.ret AS growth_ret,
    d.prev_nav * (1 + g.ret) - d.nav AS payout_per_unit,
    payout_per_unit / d.prev_nav AS payout_pct
FROM
(
    SELECT scheme_code, date, prev_date, nav, prev_nav, ret FROM nav_clean
    WHERE prev_nav > 0
      AND scheme_code IN (SELECT scheme_code FROM scheme_siblings WHERE relation = 'growth')
      -- Bonus options distribute units, not cash; their NAV drops are not payouts
      AND scheme_code IN (SELECT scheme_code FROM scheme_info WHERE option = 'IDCW')
) AS d
INNER JOIN (SELECT scheme_code, sibling_code FROM scheme_siblings WHERE relation = 'growth') AS s
    ON s.scheme_code = d.scheme_code
INNER JOIN
(
    SELECT scheme_code, date, prev_date, ret FROM nav_clean
    WHERE prev_nav > 0
      AND scheme_code IN (SELECT sibling_code FROM scheme_siblings WHERE relation = 'growth')
) AS g
    ON g.scheme_code = s.sibling_code AND g.date = d.date
WHERE g.prev_date = d.prev_date AND g.ret - d.ret >= min_gap;

-- Per-scheme data quality, exposed so the product can show how trustworthy each series is.
CREATE TABLE IF NOT EXISTS data_quality
(
    scheme_code       UInt32,
    raw_dates         UInt64,
    clean_dates       UInt64,
    glitches_removed  UInt64,
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
ORDER BY scheme_code;

CREATE MATERIALIZED VIEW IF NOT EXISTS data_quality_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO data_quality EMPTY AS
SELECT
    i.scheme_code AS scheme_code,
    ifNull(r.raw_dates, 0) AS raw_dates,
    ifNull(c.clean_dates, 0) AS clean_dates,
    ifNull(g.glitches, 0) AS glitches_removed,
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
LEFT JOIN (SELECT scheme_code, uniqExact(date) AS raw_dates FROM nav GROUP BY scheme_code) AS r
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
LEFT JOIN (SELECT scheme_code, count() AS events FROM idcw_events GROUP BY scheme_code) AS e
    ON e.scheme_code = i.scheme_code
SETTINGS join_use_nulls = 1;
