-- Benchmark-relative statistics per (basis, window, benchmark) for 1Y/3Y/5Y.
-- benchmark = 'category' (equal-weighted category index) or 'index' (AMFI tier-1 index proxy).
-- A row exists only when the benchmark covers every period of the window.
CREATE OR REPLACE TABLE fund_relative
(
    scheme_code         UInt32,
    basis               LowCardinality(String),
    period              LowCardinality(String),
    benchmark           LowCardinality(String),
    n_obs               UInt32,
    periods_per_year    Float64,
    fund_cagr           Float64,
    benchmark_cagr      Float64,
    excess_cagr         Float64,
    beta                Nullable(Float64),
    alpha               Nullable(Float64),
    correlation         Nullable(Float64),
    r_squared           Nullable(Float64),
    tracking_error      Float64,
    information_ratio   Nullable(Float64),
    treynor             Nullable(Float64),
    m_squared           Nullable(Float64),
    up_capture          Nullable(Float64),
    down_capture        Nullable(Float64),
    capture_ratio       Nullable(Float64),
    batting_average     Float64,
    up_pct_ratio        Nullable(Float64),       -- share of up-benchmark periods the fund beat
    down_pct_ratio      Nullable(Float64)        -- share of down-benchmark periods the fund beat
)
ENGINE = MergeTree
ORDER BY (scheme_code, basis, period, benchmark)
AS
WITH
    windows AS
    (
        SELECT scheme_code, last_nav_date, inception_date,
               -- last complete month (see fund_monthly.is_complete)
               if(is_active AND toLastDayOfMonth(last_nav_date) <= as_of_date,
                  toStartOfMonth(last_nav_date), addMonths(toStartOfMonth(last_nav_date), -1)) AS last_month
        FROM scheme_info
        WHERE nav_count >= 2
    ),
    obs AS
    (
        SELECT d.scheme_code AS scheme_code, 'daily' AS basis, w.1 AS period, w.2 AS w_years,
               w.3 AS w_target, d.date AS date, d.prev_date AS prev_date,
               d.ret AS r, d.rf_ret AS rf, d.cat_ret AS cat, d.idx_ret AS idx
        FROM fund_daily AS d
        INNER JOIN windows AS i ON i.scheme_code = d.scheme_code
        ARRAY JOIN arrayFilter(x -> x.3 >= i.inception_date AND d.date > x.3, [
            ('1Y', 1., addYears(i.last_nav_date, -1)),
            ('3Y', 3., addYears(i.last_nav_date, -3)),
            ('5Y', 5., addYears(i.last_nav_date, -5))
        ]) AS w
        UNION ALL
        SELECT m.scheme_code, 'monthly', w.1, w.2, w.3, m.date, m.prev_date, m.ret, m.rf_ret, m.cat_ret, m.idx_ret
        FROM fund_monthly AS m
        INNER JOIN windows AS i ON i.scheme_code = m.scheme_code
        ARRAY JOIN arrayFilter(x -> m.month > x.3 AND m.month <= i.last_month, [
            ('1Y', 1., addMonths(i.last_month, -12)),
            ('3Y', 3., addMonths(i.last_month, -36)),
            ('5Y', 5., addMonths(i.last_month, -60))
        ]) AS w
        WHERE m.is_complete
    ),
    paired AS
    (
        -- one row per period per benchmark; bm stays NULL where the benchmark has no data
        SELECT scheme_code, basis, period, w_years, w_target, date, prev_date, r, rf, b.1 AS benchmark, b.2 AS bm
        FROM obs
        ARRAY JOIN [('category', cat), ('index', idx)] AS b
    ),
    stats AS
    (
        SELECT
            scheme_code, basis, period, benchmark,
            countIf(bm IS NULL) AS missing,
            count() AS n,
            any(w_years) AS yrs,
            if(basis = 'monthly', 12., n / yrs) AS ppy,
            sum(log1p(r)) AS log_growth_f,
            sum(log1p(bm)) AS log_growth_b,
            covarSamp(r - rf, bm - rf) AS cov_eb,
            varSamp(bm - rf) AS var_eb,
            avg(r - rf) AS mean_ef,
            avg(bm - rf) AS mean_eb,
            stddevSamp(r - rf) AS sd_ef,
            corr(r - rf, bm - rf) AS rho,
            stddevSamp(r - bm) AS sd_active,
            avg(r - bm) AS mean_active,
            stddevSamp(bm) AS sd_b,
            avg(rf) AS mean_rf,
            countIf(bm >= 0) AS n_up,
            countIf(bm < 0) AS n_down,
            sumIf(log1p(r), bm >= 0) AS lg_f_up,
            sumIf(log1p(bm), bm >= 0) AS lg_b_up,
            sumIf(log1p(r), bm < 0) AS lg_f_down,
            sumIf(log1p(bm), bm < 0) AS lg_b_down,
            countIf(r >= bm) AS n_beat_or_match,
            countIf(r > bm AND bm >= 0) AS n_beat_up,
            countIf(r > bm AND bm < 0) AS n_beat_down
        FROM paired
        GROUP BY scheme_code, basis, period, benchmark
        -- the benchmark must cover every period of the window; monthly windows need every month,
        -- daily windows a base NAV within 10 days of the window start
        HAVING missing = 0 AND n >= 2
           AND if(basis = 'monthly', n = toUInt64(round(yrs * 12)),
                  dateDiff('day', argMin(prev_date, date), any(w_target)) <= 10)
    )
SELECT
    scheme_code, basis, period, benchmark, n_obs, periods_per_year, fund_cagr, benchmark_cagr, excess_cagr,
    beta, alpha, correlation, r_squared, tracking_error, information_ratio, treynor, m_squared, up_capture,
    down_capture, capture_ratio, batting_average, up_pct_ratio, down_pct_ratio
FROM
(
    SELECT
        scheme_code, basis, period, benchmark,
        toUInt32(n) AS n_obs,
        ppy AS periods_per_year,
        exp(log_growth_f / yrs) - 1 AS fund_cagr,
        exp(log_growth_b / yrs) - 1 AS benchmark_cagr,
        fund_cagr - benchmark_cagr AS excess_cagr,
        if(var_eb > 0, cov_eb / var_eb, NULL) AS beta,
        (mean_ef - beta * mean_eb) * ppy AS alpha,
        rho AS correlation,
        rho * rho AS r_squared,
        assumeNotNull(sd_active) * sqrt(ppy) AS tracking_error,
        if(tracking_error > 0, mean_active * ppy / tracking_error, NULL) AS information_ratio,
        if(beta != 0, mean_ef * ppy / beta, NULL) AS treynor,
        if(sd_ef > 0, mean_ef / sd_ef * sd_b * ppy + mean_rf * ppy, NULL) AS m_squared,
        if(n_up > 0, exp(lg_f_up * ppy / n_up) - 1, NULL) AS fund_up,
        if(n_up > 0, exp(lg_b_up * ppy / n_up) - 1, NULL) AS bench_up,
        if(n_down > 0, exp(lg_f_down * ppy / n_down) - 1, NULL) AS fund_down,
        if(n_down > 0, exp(lg_b_down * ppy / n_down) - 1, NULL) AS bench_down,
        if(bench_up != 0, fund_up / bench_up, NULL) AS up_capture,
        if(bench_down != 0, fund_down / bench_down, NULL) AS down_capture,
        if(down_capture > 0, up_capture / down_capture, NULL) AS capture_ratio,
        n_beat_or_match / n AS batting_average,
        if(n_up > 0, n_beat_up / n_up, NULL) AS up_pct_ratio,
        if(n_down > 0, n_beat_down / n_down, NULL) AS down_pct_ratio
    FROM stats
)
