-- SIP returns: a fixed monthly installment (settings.sip_monthly_amount) on the first NAV date of
-- each month, valued at the latest NAV. Tenures cover the N whole months before the current
-- month; SI starts at the first month with a NAV. XIRR uses ClickHouse's native
-- financialInternalRateOfReturnExtended (ACT/365F, same as Excel's XIRR).
CREATE OR REPLACE TABLE fund_sip
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
ORDER BY (scheme_code, tenure_order)
AS
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
)
