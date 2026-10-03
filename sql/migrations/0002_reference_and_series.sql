-- Refreshable materialized views, part 1: cleaned NAV series, scheme reference data, and
-- the benchmark/risk-free series every metric is measured against.
--
-- Scheduling: each view is refreshed explicitly by `mf refresh` in dependency order
-- (src/refresh.rs::REFRESH_ORDER), right after ingestion. ClickHouse does not cascade a manual
-- refresh to DEPENDS ON children, and a stopped view ignores manual refreshes, so the views carry
-- a nominal yearly schedule that never matters in practice. EMPTY skips the refresh at creation.

-- Single-day NAV spikes that the next NAV reverses (data-entry errors). Excluded from analytics,
-- kept in the raw `nav` table and listed here for auditing.
CREATE TABLE IF NOT EXISTS nav_glitches
(
    scheme_code UInt32,
    date        Date,
    nav         Float64,
    prev_nav    Float64,
    next_nav    Float64,
    move        Float64
)
ENGINE = MergeTree
ORDER BY (scheme_code, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS nav_glitches_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO nav_glitches EMPTY AS
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
    FROM (SELECT scheme_code, date, argMax(nav, ingested_at) AS nav FROM nav GROUP BY scheme_code, date)
    WINDOW w AS (PARTITION BY scheme_code ORDER BY date ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING)
)
WHERE prev_nav > 0 AND next_nav > 0
  AND abs(nav / prev_nav - 1) >= min_move
  AND abs(next_nav / prev_nav - 1) <= max_reversal;

-- The analytics base series: one deduplicated NAV per scheme per date, glitches removed, with
-- the previous NAV and the simple return since it. prev_nav = 0 marks a scheme's first NAV.
CREATE TABLE IF NOT EXISTS nav_clean
(
    scheme_code UInt32,
    date        Date,
    nav         Float64,
    prev_date   Date,
    prev_nav    Float64,
    ret         Float64,
    gap_days    UInt16
)
ENGINE = MergeTree
ORDER BY (scheme_code, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS nav_clean_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO nav_clean EMPTY AS
SELECT
    scheme_code,
    date,
    nav,
    lagInFrame(date, 1, toDate(0)) OVER w AS prev_date,
    lagInFrame(nav, 1, 0.) OVER w AS prev_nav,
    if(prev_nav > 0, nav / prev_nav - 1, 0.) AS ret,
    toUInt16(if(prev_nav > 0, dateDiff('day', prev_date, date), 0)) AS gap_days
FROM
(
    SELECT scheme_code, date, argMax(nav, ingested_at) AS nav
    FROM nav
    WHERE (scheme_code, date) NOT IN (SELECT scheme_code, date FROM nav_glitches)
    GROUP BY scheme_code, date
)
WINDOW w AS (PARTITION BY scheme_code ORDER BY date ROWS BETWEEN 1 PRECEDING AND CURRENT ROW);

-- One row per scheme: metadata normalised to SEBI's 2026 categories (config/categories.csv),
-- plan/option parsed from the scheme name, NAV coverage, and peer-group eligibility.
CREATE TABLE IF NOT EXISTS scheme_info
(
    scheme_code           UInt32,
    scheme_name           String,
    fund_house            LowCardinality(String),
    scheme_type           LowCardinality(String),
    raw_category          LowCardinality(String),
    asset_class           LowCardinality(String),
    category              LowCardinality(String),
    plan                  LowCardinality(String),   -- Direct | Regular
    option                LowCardinality(String),   -- Growth | IDCW | Bonus
    idcw_frequency        LowCardinality(String),   -- '' unless option = IDCW
    is_legacy_plan        UInt8,                    -- Retail/Institutional/Unclaimed/Segregated classes
    base_name             String,                   -- name without plan/option words, for siblings
    isin_growth           Nullable(String),
    isin_div_reinvestment Nullable(String),
    inception_date        Nullable(Date),           -- first NAV available (not the legal launch date)
    last_nav_date         Nullable(Date),
    last_nav              Nullable(Float64),
    nav_count             UInt32,
    as_of_date            Date,                     -- the market's latest NAV date (mode over schemes)
    is_active             UInt8,
    rankable_category     UInt8,
    peer_eligible         UInt8                     -- included in category ranks and category index
)
ENGINE = MergeTree
ORDER BY scheme_code;

CREATE MATERIALIZED VIEW IF NOT EXISTS scheme_info_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO scheme_info EMPTY AS
WITH
    (SELECT toUInt32(any(value)) FROM settings WHERE key = 'active_within_days') AS active_days,
    coverage AS
    (
        SELECT scheme_code, min(date) AS first_date, max(date) AS last_date,
               argMax(nav, date) AS last_nav, count() AS n
        FROM nav_clean
        GROUP BY scheme_code
    ),
    -- Most common newest-NAV date among recently updated schemes. Robust to liquid funds that
    -- publish weekend NAVs ahead of time and to stray future-dated rows.
    (
        SELECT argMax(d, c)
        FROM (SELECT last_date AS d, count() AS c FROM coverage
              WHERE last_date >= (SELECT max(last_date) FROM coverage) - 30 GROUP BY d)
    ) AS market_date
SELECT
    s.scheme_code AS scheme_code,
    s.scheme_name AS scheme_name,
    s.fund_house AS fund_house,
    if(s.scheme_type IN ('Open Ended Schemes', 'Close Ended Schemes', 'Interval Fund Schemes'),
       s.scheme_type, 'Unknown') AS scheme_type,
    s.scheme_category AS raw_category,
    coalesce(m.asset_class, 'Unclassified') AS asset_class,
    coalesce(m.category, 'Unclassified') AS category,
    if(match(s.lname, '\\bdirect\\b'), 'Direct', 'Regular') AS plan,
    multiIf(match(s.lname_opt, '\\bbonus\\b'), 'Bonus',
            match(s.lname_opt, 'idcw|dividend|\\bdiv\\b|payout|reinvest|income distribution'), 'IDCW',
            'Growth') AS option,
    if(option = 'IDCW',
       multiIf(match(s.lname_opt, 'daily'), 'Daily',
               match(s.lname_opt, 'weekly'), 'Weekly',
               match(s.lname_opt, 'fortnight'), 'Fortnightly',
               match(s.lname_opt, 'half[ -]?yearly|semi[ -]?annual'), 'Half-Yearly',
               match(s.lname_opt, 'monthly'), 'Monthly',
               match(s.lname_opt, 'quarterly'), 'Quarterly',
               match(s.lname_opt, 'annual|yearly'), 'Annual',
               ''),
       '') AS idcw_frequency,
    toUInt8(match(s.lname, '\\b(retail|institutional|unclaimed|segregated|plan b)\\b')) AS is_legacy_plan,
    trimBoth(replaceRegexpAll(replaceRegexpAll(
        s.lname_opt,
        '\\b(direct|regular|plan|option|growth|idcw|dividend|div|payout|reinvestment|reinvest|bonus|daily|weekly|fortnightly|monthly|quarterly|half yearly|half-yearly|annual|yearly|income distribution cum capital withdrawal|of|and|cum)\\b',
        ' '), '[^a-z0-9]+', ' ')) AS base_name,
    s.isin_growth AS isin_growth,
    s.isin_div_reinvestment AS isin_div_reinvestment,
    c.first_date AS inception_date,
    c.last_date AS last_nav_date,
    c.last_nav AS last_nav,
    toUInt32(ifNull(c.n, 0)) AS nav_count,
    market_date AS as_of_date,
    toUInt8(ifNull(c.last_date >= market_date - active_days, 0)) AS is_active,
    toUInt8(ifNull(m.rankable, 0)) AS rankable_category,
    toUInt8(is_active AND rankable_category AND option = 'Growth' AND NOT is_legacy_plan
            AND scheme_type = 'Open Ended Schemes') AS peer_eligible
FROM
(
    SELECT *, lower(scheme_name) AS lname,
           -- "Dividend Yield" is an equity category, not a payout option.
           replaceRegexpAll(lname, 'dividend\\s+yield', 'dyield') AS lname_opt
    FROM schemes FINAL
) AS s
LEFT JOIN coverage AS c ON c.scheme_code = s.scheme_code
LEFT JOIN category_map AS m ON m.raw_category = s.scheme_category
SETTINGS join_use_nulls = 1;

-- Sibling share classes of the same scheme, matched on fund house + normalised name.
-- Only unambiguous one-to-one matches among recently active schemes are kept.
--   relation = 'regular' : sibling is the Regular plan of this Direct scheme (and 'direct' back)
--   relation = 'growth'  : sibling is the Growth option of this IDCW/Bonus scheme (same plan)
CREATE TABLE IF NOT EXISTS scheme_siblings
(
    scheme_code  UInt32,
    relation     LowCardinality(String),
    sibling_code UInt32
)
ENGINE = MergeTree
ORDER BY (scheme_code, relation);

CREATE MATERIALIZED VIEW IF NOT EXISTS scheme_siblings_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO scheme_siblings EMPTY AS
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
ARRAY JOIN arrayMap(o -> (o, 'growth', g[1]), others) AS p;

-- Equal-weighted category index per (category, plan): the mean daily return of every Growth
-- fund in the category that published that day, chained into a level series (base 100).
-- Funds that later closed stay in for the days they existed (no survivorship bias). Category
-- membership uses each fund's current category.
CREATE TABLE IF NOT EXISTS category_index
(
    category LowCardinality(String),
    plan     LowCardinality(String),
    date     Date,
    ret      Float64,
    n_funds  UInt32,
    level    Float64
)
ENGINE = MergeTree
ORDER BY (category, plan, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS category_index_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO category_index EMPTY AS
SELECT
    category, plan, date, ret, n_funds,
    100 * exp(sum(log1p(ret)) OVER (PARTITION BY category, plan ORDER BY date
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS level
FROM
(
    SELECT i.category AS category, i.plan AS plan, n.date AS date,
           avg(n.ret) AS ret, toUInt32(count()) AS n_funds
    FROM nav_clean AS n
    INNER JOIN scheme_info AS i ON i.scheme_code = n.scheme_code
    WHERE n.prev_nav > 0
      AND n.gap_days <= 7                -- skip catch-up returns after long gaps
      AND abs(n.ret) < 0.25              -- residual bad ticks must not move a category
      AND i.option = 'Growth' AND i.rankable_category AND NOT i.is_legacy_plan
      AND i.scheme_type = 'Open Ended Schemes'
    GROUP BY category, plan, date
    HAVING n_funds >= 3
);

-- Every benchmark-like series as a level on every calendar day (forward-filled), so a return
-- over any fund interval (prev_date, date] is a two-key lookup:
--   'cat|<category>|<plan>' category index, 'proxy|<code>' index-fund proxy NAV,
--   'rf' risk-free: the liquid-fund proxy NAV, extended backwards before its first NAV at the
--        configured fallback rate (or entirely synthetic if no proxy is configured).
CREATE TABLE IF NOT EXISTS benchmark_daily
(
    bench_key LowCardinality(String),
    date      Date,
    level     Float64
)
ENGINE = MergeTree
ORDER BY (bench_key, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS benchmark_daily_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO benchmark_daily EMPTY AS
WITH
    -- scalar subqueries are Nullable; ifNull keeps the arithmetic below non-nullable
    ifNull((SELECT toUInt32(any(value)) FROM settings WHERE key = 'risk_free_proxy_scheme_code'), 0) AS rf_code,
    ifNull((SELECT any(value) FROM settings WHERE key = 'risk_free_fallback_rate'), 0.) AS rf_fallback,
    ifNull((SELECT min(date) FROM nav_clean), toDate(0)) AS d0,
    ifNull((SELECT max(date) FROM nav_clean), toDate(0)) AS d1,
    source AS
    (
        SELECT concat('cat|', category, '|', plan) AS bench_key, date, level FROM category_index
        UNION ALL
        SELECT concat('proxy|', toString(scheme_code)), date, nav FROM nav_clean
        WHERE scheme_code IN (SELECT scheme_code FROM benchmark_proxy) OR scheme_code = rf_code
    ),
    filled AS
    (
        SELECT cal.bench_key AS bench_key, cal.date AS date, s.level AS level
        FROM
        (
            SELECT bench_key, first_date + number AS date
            FROM (SELECT bench_key, min(date) AS first_date FROM source GROUP BY bench_key)
            ARRAY JOIN range(toUInt32(greatest(dateDiff('day', first_date, d1), 0) + 1)) AS number
        ) AS cal
        ASOF INNER JOIN source AS s ON s.bench_key = cal.bench_key AND cal.date >= s.date
    ),
    rf_proxy AS (SELECT date, level FROM filled WHERE bench_key = concat('proxy|', toString(rf_code))),
    ifNull((SELECT min(date) FROM rf_proxy), toDate(0)) AS rf_first,
    ifNull((SELECT argMin(level, date) FROM rf_proxy), 0.) AS rf_first_level
SELECT bench_key, date, level FROM filled
UNION ALL
SELECT 'rf', date, level FROM rf_proxy
UNION ALL
-- Before the proxy exists: compound the fallback rate backwards from the proxy's first level.
SELECT 'rf', d0 + number AS date,
       if(rf_first_level > 0, rf_first_level, 1.)
         * pow(1 + rf_fallback, dateDiff('day', if(rf_first_level > 0, rf_first, d1), date) / 365.)
FROM numbers(toUInt32(greatest(dateDiff('day', d0, if(rf_first_level > 0, rf_first - 1, d1)) + 1, 0)));

-- Daily fact table for window metrics: every NAV-to-NAV return with the risk-free, category and
-- index-proxy returns over the exact same interval. cat_ret/idx_ret are NULL where that
-- benchmark has no data for the interval.
CREATE TABLE IF NOT EXISTS fund_daily
(
    scheme_code UInt32,
    date        Date,
    prev_date   Date,
    nav         Float64,
    prev_nav    Float64,
    ret         Float64,
    rf_ret      Float64,
    cat_ret     Nullable(Float64),
    idx_ret     Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (scheme_code, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_daily_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_daily EMPTY AS
SELECT
    n.scheme_code AS scheme_code, n.date AS date, n.prev_date AS prev_date,
    n.nav AS nav, n.prev_nav AS prev_nav, n.ret AS ret,
    rf1.level / rf0.level - 1 AS rf_ret,
    c1.level / c0.level - 1 AS cat_ret,
    p1.level / p0.level - 1 AS idx_ret
FROM
(
    SELECT n.scheme_code, n.date, n.prev_date, n.nav, n.prev_nav, n.ret,
           concat('cat|', i.category, '|', i.plan) AS cat_key,
           if(bp.scheme_code > 0, concat('proxy|', toString(bp.scheme_code)), '') AS idx_key
    FROM nav_clean AS n
    INNER JOIN scheme_info AS i ON i.scheme_code = n.scheme_code
    LEFT JOIN benchmark_proxy AS bp ON bp.category = i.category
    WHERE n.prev_nav > 0
) AS n
INNER JOIN (SELECT date, level FROM benchmark_daily WHERE bench_key = 'rf') AS rf1 ON rf1.date = n.date
INNER JOIN (SELECT date, level FROM benchmark_daily WHERE bench_key = 'rf') AS rf0 ON rf0.date = n.prev_date
LEFT JOIN benchmark_daily AS c1 ON c1.bench_key = n.cat_key AND c1.date = n.date
LEFT JOIN benchmark_daily AS c0 ON c0.bench_key = n.cat_key AND c0.date = n.prev_date
LEFT JOIN benchmark_daily AS p1 ON p1.bench_key = n.idx_key AND p1.date = n.date
LEFT JOIN benchmark_daily AS p0 ON p0.bench_key = n.idx_key AND p0.date = n.prev_date
SETTINGS join_use_nulls = 1;

-- Monthly fact table: month-end NAV (last NAV in the calendar month) and the return since the
-- previous month-end, plus benchmark returns over the same two dates. Morningstar and Value
-- Research compute standard deviation, Sharpe, beta and alpha from monthly returns; the monthly
-- risk metrics use this table. is_complete = 0 for a month that has not finished yet.
CREATE TABLE IF NOT EXISTS fund_monthly
(
    scheme_code UInt32,
    month       Date,
    date        Date,
    nav         Float64,
    prev_date   Date,
    prev_nav    Float64,
    ret         Float64,
    rf_ret      Float64,
    cat_ret     Nullable(Float64),
    idx_ret     Nullable(Float64),
    is_complete UInt8
)
ENGINE = MergeTree
ORDER BY (scheme_code, month);

CREATE MATERIALIZED VIEW IF NOT EXISTS fund_monthly_mv
REFRESH EVERY 1 YEAR SETTINGS refresh_retries = 1
TO fund_monthly EMPTY AS
SELECT
    m.scheme_code AS scheme_code, m.month AS month, m.date AS date, m.nav AS nav,
    m.prev_date AS prev_date, m.prev_nav AS prev_nav, m.nav / m.prev_nav - 1 AS ret,
    rf1.level / rf0.level - 1 AS rf_ret,
    c1.level / c0.level - 1 AS cat_ret,
    p1.level / p0.level - 1 AS idx_ret,
    m.is_complete AS is_complete
FROM
(
    SELECT
        scheme_code, month, date, nav, cat_key, idx_key, is_complete,
        lagInFrame(month, 1, toDate(0)) OVER w AS prev_month,
        lagInFrame(date, 1, toDate(0)) OVER w AS prev_date,
        lagInFrame(nav, 1, 0.) OVER w AS prev_nav
    FROM
    (
        SELECT n.scheme_code AS scheme_code, toStartOfMonth(n.date) AS month,
               max(n.date) AS date, argMax(n.nav, n.date) AS nav,
               any(concat('cat|', i.category, '|', i.plan)) AS cat_key,
               any(if(bp.scheme_code > 0, concat('proxy|', toString(bp.scheme_code)), '')) AS idx_key,
               -- complete once the market has reached the month's last calendar day (active
               -- schemes), or once the scheme has a NAV in a later month
               toUInt8(month < toStartOfMonth(any(i.last_nav_date))
                       OR (any(i.is_active) AND toLastDayOfMonth(month) <= any(i.as_of_date))) AS is_complete
        FROM nav_clean AS n
        INNER JOIN scheme_info AS i ON i.scheme_code = n.scheme_code
        LEFT JOIN benchmark_proxy AS bp ON bp.category = i.category
        GROUP BY scheme_code, month
    )
    WINDOW w AS (PARTITION BY scheme_code ORDER BY month ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
) AS m
INNER JOIN (SELECT date, level FROM benchmark_daily WHERE bench_key = 'rf') AS rf1 ON rf1.date = m.date
INNER JOIN (SELECT date, level FROM benchmark_daily WHERE bench_key = 'rf') AS rf0 ON rf0.date = m.prev_date
LEFT JOIN benchmark_daily AS c1 ON c1.bench_key = m.cat_key AND c1.date = m.date
LEFT JOIN benchmark_daily AS c0 ON c0.bench_key = m.cat_key AND c0.date = m.prev_date
LEFT JOIN benchmark_daily AS p1 ON p1.bench_key = m.idx_key AND p1.date = m.date
LEFT JOIN benchmark_daily AS p0 ON p0.bench_key = m.idx_key AND p0.date = m.prev_date
-- Only consecutive months: a month after a gap would span several months.
WHERE m.prev_nav > 0 AND m.prev_month = addMonths(m.month, -1)
SETTINGS join_use_nulls = 1;
