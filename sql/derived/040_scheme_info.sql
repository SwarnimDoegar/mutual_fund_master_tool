-- One row per scheme: metadata normalised to SEBI's 2026 categories (config/categories.csv),
-- plan/option parsed from the scheme name, NAV coverage, and peer-group eligibility.
CREATE OR REPLACE TABLE scheme_info
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
ORDER BY scheme_code
AS
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
SETTINGS join_use_nulls = 1
