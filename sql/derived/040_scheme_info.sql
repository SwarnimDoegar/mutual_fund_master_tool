-- One row per scheme: metadata normalised to SEBI's 2026 categories (config/categories.csv),
-- plan/option parsed from the scheme's names, NAV coverage, and peer-group membership.
--
-- Each scheme has two names. AMFI's daily NAV file (mfapi's source, schemes.scheme_name) sometimes
-- names a plan by the fund alone ("Motilal Oswal Liquid Fund" for 20 plans) or gives two plans
-- one name. AMFI's scheme master (scheme_master.nav_name) names every plan, but keeps names from
-- launch (Bandhan's "Regular Plan B" is today's only Regular plan). So the daily name decides what
-- it states and no other scheme shares, and the master name decides the rest.
CREATE OR REPLACE TABLE scheme_info
(
    scheme_code           UInt32,
    scheme_name           String,
    fund_house            LowCardinality(String),
    scheme_type           LowCardinality(String),
    raw_category          LowCardinality(String),
    asset_class           LowCardinality(String),
    category              LowCardinality(String),
    plan                  LowCardinality(String),   -- Direct | Regular | '' (ETFs have no plans)
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
    peer_eligible         UInt8,                    -- peer_member and active: ranked today
    peer_member           UInt8                     -- in its category's peer group (category index)
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
    -- An ETF (AMFI's category says so) trades on the exchange as one unit class, so it has no
    -- plan, whatever its names say. Otherwise the first name that names one plan only (Kotak's
    -- "Regular Plan - Payout of IDCW option- Direct" names both), then the first that says
    -- "Direct Plan", "Regular Plan" or "Direct"; Regular when neither does (pre-2013 plans).
    multiIf(s.scheme_category LIKE '%ETF%', '',
            s.only_plan_1 != '', s.only_plan_1, s.only_plan_2 != '', s.only_plan_2,
            s.stated_plan_1 != '', s.stated_plan_1, s.stated_plan_2 != '', s.stated_plan_2,
            'Regular') AS plan,
    -- "Quarterly Option" alone is a quarterly IDCW option.
    multiIf(match(s.opt_name, '\\bbonus\\b'), 'Bonus',
            match(s.opt_name, 'idcw|dividend|\\bdiv\\b|payout|reinvest|income distribution|\\b(daily|weekly|fortnightly|monthly|quarterly|half[ -]?yearly|annual) option\\b'), 'IDCW',
            'Growth') AS option,
    if(option = 'IDCW',
       multiIf(match(s.opt_name, 'daily'), 'Daily',
               match(s.opt_name, 'weekly'), 'Weekly',
               match(s.opt_name, 'fortnight'), 'Fortnightly',
               match(s.opt_name, 'half[ -]?yearly|semi[ -]?annual'), 'Half-Yearly',
               match(s.opt_name, 'monthly'), 'Monthly',
               match(s.opt_name, 'quarterly'), 'Quarterly',
               match(s.opt_name, 'annual|yearly'), 'Annual',
               ''),
       '') AS idcw_frequency,
    s.legacy AS is_legacy_plan,
    trimBoth(replaceRegexpAll(replaceRegexpAll(
        s.base_source,
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
    toUInt8(is_active AND peer_member) AS peer_eligible,
    -- Growth options of current plans. A category with an active open-ended scheme ranks only
    -- open-ended schemes (a closed-ended ELSS cannot be bought); a category made only of
    -- closed-ended and interval schemes (fixed maturity plans) ranks those among themselves.
    toUInt8(rankable_category AND option = 'Growth' AND NOT is_legacy_plan
            AND (scheme_type = 'Open Ended Schemes'
                 OR NOT max(scheme_type = 'Open Ended Schemes' AND is_active) OVER (PARTITION BY category))) AS peer_member
FROM
(
    SELECT
        sc.*,
        lower(sc.scheme_name) AS lname,
        lower(ifNull(am.nav_name, '')) AS mname,
        -- "Dividend Yield" is an equity category, and "Nifty Dividend Opportunities 50" an index:
        -- neither is a payout option.
        replaceRegexpAll(lname, 'dividend\\s+(yield|opportunities|leaders)|stable\\s+dividend', 'dyield') AS lname_opt,
        replaceRegexpAll(mname, 'dividend\\s+(yield|opportunities|leaders)|stable\\s+dividend', 'dyield') AS mname_opt,
        -- Another scheme has the same daily name, so it cannot tell the two apart.
        mname != '' AND count() OVER (PARTITION BY replaceRegexpAll(trimBoth(lname), '\\s+', ' ')) > 1 AS name_shared,
        match(lname, '\\b(direct|regular)\\b') AS names_plan,
        if(name_shared, mname, lname) AS name_1,
        if(name_shared, lname, mname) AS name_2,
        multiIf(match(name_1, '\\bdirect\\b') AND NOT match(name_1, '\\bregular\\b'), 'Direct',
                match(name_1, '\\bregular\\b') AND NOT match(name_1, '\\bdirect\\b'), 'Regular', '') AS only_plan_1,
        multiIf(match(name_2, '\\bdirect\\b') AND NOT match(name_2, '\\bregular\\b'), 'Direct',
                match(name_2, '\\bregular\\b') AND NOT match(name_2, '\\bdirect\\b'), 'Regular', '') AS only_plan_2,
        multiIf(match(name_1, '\\bdirect\\s*-?\\s*plan\\b'), 'Direct', match(name_1, '\\bregular\\s*-?\\s*plan\\b'), 'Regular',
                match(name_1, '\\bdirect\\b'), 'Direct', '') AS stated_plan_1,
        multiIf(match(name_2, '\\bdirect\\s*-?\\s*plan\\b'), 'Direct', match(name_2, '\\bregular\\s*-?\\s*plan\\b'), 'Regular',
                match(name_2, '\\bdirect\\b'), 'Direct', '') AS stated_plan_2,
        -- An ETF is one unit class. SBI's daily names say "Regular Plan - IDCW" for ETFs that
        -- pay nothing; the master says IDCW only for those that pay (liquid ETFs), so it decides.
        multiIf(scheme_category LIKE '%ETF%' AND mname != '', mname_opt,
                match(mname_opt, '\\bbonus\\b|idcw|dividend|\\bdiv\\b|payout|reinvest|income distribution|\\bgrowth\\b|\\b(daily|weekly|fortnightly|monthly|quarterly|half[ -]?yearly|annual) option\\b')
                AND (name_shared OR NOT match(lname_opt, '\\bbonus\\b|idcw|dividend|\\bdiv\\b|payout|reinvest|income distribution|\\bgrowth\\b|\\b(daily|weekly|fortnightly|monthly|quarterly|half[ -]?yearly|annual) option\\b')), mname_opt,
                lname_opt) AS opt_name,
        if(mname != '' AND (name_shared OR NOT names_plan), mname_opt, lname_opt) AS base_source,
        -- Legacy share classes, closed to new money. "(Existing number of Segregated Portfolios
        -- - 1)" in a daily name describes the main portfolio; the segregated portfolio itself
        -- has the same daily name and only the master says "Segregated Portfolio 1". "Plan B"
        -- in a master name is believed only where the daily name does not name the plan.
        toUInt8(match(replaceRegexpAll(lname, '\\([^)]*segregated portfolios[^)]*\\)', ' '),
                      '\\b(retail|institutional|instn|unclaimed|segregated|defunct|sg ?\\d|eco plan|pf|plan [bc])\\b')
                OR match(mname, '\\b(retail|institutional|instn|unclaimed|segregated|defunct|sg ?\\d|eco plan|pf)\\b')
                OR ((name_shared OR NOT names_plan) AND match(mname, '\\bplan [bc]\\b'))) AS legacy
    FROM schemes AS sc FINAL
    LEFT JOIN (SELECT scheme_code, argMax(nav_name, updated_at) AS nav_name FROM scheme_master GROUP BY scheme_code) AS am
        ON am.scheme_code = sc.scheme_code
) AS s
LEFT JOIN coverage AS c ON c.scheme_code = s.scheme_code
LEFT JOIN category_map AS m ON m.raw_category = s.scheme_category
SETTINGS join_use_nulls = 1
