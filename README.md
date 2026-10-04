# Mutual fund analytics pipeline

Pulls every Indian mutual fund NAV from [mfapi.in](https://www.mfapi.in/) into ClickHouse once a
day and computes about 250 metrics per scheme (returns, rolling returns, SIP XIRR, risk,
drawdowns, benchmark-relative statistics, peer ranks) **in ClickHouse, as plain SQL**: after each
ingest, every metric table is rebuilt from the raw NAVs with `CREATE OR REPLACE TABLE ... AS
SELECT`. The Rust service only ingests data and runs those SQL files in order.

A read-only REST API (`api/`, crate `mf-api`) serves the tables; a web UI is the next project.

```
mfapi.in ──► mf (Rust) ──► ClickHouse ──► mf-api (Rust, axum) ──► clients
                                              └──► Redis (shared response cache)
             ingest          stored:   schemes, nav (ReplacingMergeTree, idempotent), config, rank history
             refresh ──────► derived:  19 tables + 4 views, rebuilt from sql/derived/ in file order
```

## Quick start

```bash
docker compose up -d            # ClickHouse, Redis, the mf scheduler and the REST API
docker compose logs -f mf       # first start backfills all ~38k schemes (~7 min), then computes metrics (~1-2 min)
docker compose run --rm mf status
```

ClickHouse is published on `127.0.0.1:18123` (user `mf`, password `mf_local_password`; override
with `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` in `.env`).

```bash
curl -s 'http://localhost:18123/?user=mf&password=mf_local_password' --data-binary \
  "SELECT scheme_name, round(cagr_3y*100,1) AS cagr_3y, round(sharpe_3y_monthly,2) AS sharpe
   FROM mf.fund_metrics WHERE category='Flexi Cap Fund' AND plan='Direct' AND peer_eligible
   ORDER BY cagr_3y DESC LIMIT 10 FORMAT PrettyCompact"
```

API reference: http://localhost:18080/docs (OpenAPI document at `/openapi.json`).

```bash
curl -s 'localhost:18080/v1/screener?category=Flexi%20Cap%20Fund&plan=Direct&peer_only=true&sort=-sharpe_3y_monthly&limit=5'
```

## REST API

Read-only, JSON, versioned under `/v1`. Every response is `{"data": ..., "meta": {"as_of_date",
"data_updated_at", ...}}`; errors are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem
details (`application/problem+json`). Returns and ratios are fractions (0.12 = 12%).

| Endpoint | What it returns |
|---|---|
| `GET /v1/meta` | Dataset summary and freshness |
| `GET /v1/schemes?q=&category=&plan=&option=&fund_house=&active=` | Search: every word must match the scheme or fund-house name; a number matches the scheme code |
| `GET /v1/schemes/{code}` | All headline metrics for one scheme (the `fund_metrics` row plus ISINs) |
| `GET /v1/schemes/{code}/nav?from=&to=&interval=day\|week\|month` | NAV history: `nav` restated across unit changes, `published_nav` as declared |
| `GET /v1/schemes/{code}/returns` · `/calendar-returns?period=` | Trailing returns · month/quarter/year/FY returns |
| `GET /v1/schemes/{code}/risk?basis=` · `/relative?basis=&benchmark=` | Risk and drawdown stats · beta/alpha/capture vs category and index |
| `GET /v1/schemes/{code}/rolling` · `/rolling/{1Y\|3Y\|5Y\|10Y}` | Rolling-return distributions · the series next to the category's |
| `GET /v1/schemes/{code}/sip` · `/drawdowns` · `/drawdowns/series` | SIP outcomes · worst drawdowns · underwater chart |
| `GET /v1/schemes/{code}/ranks?metric=&from=` · `/payouts` · `/quality` | Peer ranks (latest or history) · inferred IDCW payouts · data quality |
| `GET /v1/schemes/{code}/sip/calculate?amount=&start=YYYY-MM&end=&day=&schedule=` | SIP what-if with XIRR |
| `GET /v1/schemes/{code}/lumpsum/calculate?amount=&date=` | One-time investment what-if |
| `GET /v1/screener?category=&plan=&min_<metric>=&max_<metric>=&sort=-<metric>&fields=` | Filter and sort on any numeric `fund_metrics` column |
| `GET /v1/compare?codes=` · `/v1/compare/growth?codes=&from=` | Side-by-side metrics · growth of 100 from a common date |
| `GET /v1/categories` · `/categories/{c}/stats` · `/categories/{c}/index` | Categories · peer-group distributions · category index |
| `GET /v1/fund-houses` · `/fund-houses/{name}` · `/v1/benchmarks` | AMC scorecards · index proxies |
| `GET /health` · `GET /ready` | Liveness · ClickHouse reachable and metrics computed |

Design notes:

* **Response schemas come from the SQL.** At startup the API runs `DESCRIBE` on each endpoint's
  query and turns the column types into the OpenAPI schemas, so the docs cannot drift from the
  data. The same step refuses to start if any query no longer compiles against the database.
* **No SQL is built from input.** Values travel as typed ClickHouse parameters (`{code:UInt32}`);
  column names in the screener (`fields`, `sort`, `min_*`/`max_*`) must exist in `fund_metrics`
  as loaded from `system.columns`; unknown parameters are rejected with 400.
* **Caching (Redis).** Data changes once a day. Successful GETs are stored in Redis under
  `mfapi:v1:<data version>#<path>?<sorted query>`, shared by all API replicas, and carry a weak
  ETag (`If-None-Match` → 304) plus `Cache-Control: public, max-age=300,
  stale-while-revalidate=86400`. Every completed metric refresh changes the data version, so
  all keys and ETags change at once; superseded entries expire via TTL (`MF_API_CACHE_TTL`,
  26 h). Concurrent misses for one key run the query once per process. Redis is fail-open:
  each call has a 150 ms timeout, and if Redis is down requests are served from ClickHouse
  (`x-cache: bypass`) and `/ready` reports `cache unavailable` without failing. Redis runs as a
  pure LRU cache (`maxmemory` `REDIS_MAXMEMORY`, no persistence) and is not exposed on the host.
* **Least privilege.** The API connects as `mf_api` (`docker/clickhouse/users.d/mf-api.xml`):
  `SELECT` on `mf.*` only, `readonly=2`, and server-side constraints (15 s, 1 GB, 4 threads,
  500k rows per query) that clients cannot raise.
* Brotli/gzip compression, CORS (`MF_API_CORS_ORIGINS`), request IDs (`x-request-id`), a
  request timeout, and graceful shutdown on SIGTERM. Rate limiting is left to the reverse proxy
  or CDN in front of it.

API settings: `MF_API_BIND`, `MF_API_CLICKHOUSE_*`, `MF_API_REDIS_URL` (empty disables the
cache), `MF_API_CACHE_TTL` (93600), `MF_API_CACHE_MAX_AGE` (300), `MF_API_REQUEST_TIMEOUT` (20),
`MF_API_MAX_DB_QUERIES` (16), `MF_API_CORS_ORIGINS`, `MF_API_PUBLIC_URL`.

## Commands

| Command | What it does |
|---|---|
| `mf run` | Default container command. Migrates, backfills if never run, then runs `daily` on `MF_SCHEDULE`. |
| `mf daily` | migrate → sync-config → ingest → refresh, logged to `pipeline_log` under one run id. |
| `mf ingest [--codes 1,2] [--full] [--snapshot-only]` | Fetch NAVs only. |
| `mf refresh [--from STEP] [--only S1,S2]` | Rebuild the derived tables and views (`sql/derived/`, in file order). |
| `mf migrate`, `mf sync-config`, `mf status` | Stored-table schema, config tables, recent runs + refresh step timings. |

Environment: `MF_SCHEDULE` (default `0 30 23 * * *;0 0 7 * * *`, i.e. 23:30 and 07:00 in
`MF_TIMEZONE`=Asia/Kolkata; AMFI publishes NAVs in the late evening, the morning run catches late
publishers), `MF_CONCURRENCY` (8 parallel history requests), `MF_CLICKHOUSE_*`, `RUST_LOG`.

## How ingestion works

* `/mf/latest` (one ~11 MB request) gives every scheme's metadata and newest NAV.
* Schemes never fetched before get their full history from `/mf/{code}` (this is the backfill).
* If a weekday lies between a scheme's newest stored NAV and the snapshot's NAV, that range is
  re-fetched. This catches skipped runs, late publishers and holidays while ordinary days
  (Mon→Tue, Fri→Mon) cost nothing. Closed schemes are not repaired.
* `nav` is a ReplacingMergeTree on `(scheme_code, date)`: re-ingesting is idempotent and a
  corrected NAV replaces the old one.

## How metrics are computed

All metrics are SQL. There are two kinds of objects:

* **Stored tables** hold data that cannot be recomputed: the raw `schemes` and `nav`, the ingest
  bookkeeping (`fetch_status`, `pipeline_log`, `scheme_nav_bounds`), the config tables and the
  rank history `fund_ranks`. They are created by the versioned migrations in `sql/migrations/`
  (applied ones are checksummed in `schema_history`).
* **Derived objects** are everything else. Each one is a file `sql/derived/NNN_<name>.sql`, and
  `mf refresh` runs the files in name order after every ingest. A table file is a single
  `CREATE OR REPLACE TABLE <name> (columns) ENGINE = MergeTree ORDER BY ... AS SELECT ...`:
  ClickHouse fills a temporary table and swaps it in atomically, so the API keeps reading the old
  table until the new one is complete, and a failing query leaves the old table in place. Changing
  a metric means editing its file; the next refresh rebuilds it. No migration, no registry.

Why not materialized views: ClickHouse's incremental MVs fire on inserts and cannot express
full-history window metrics, and refreshable MVs are a scheduler we did not want. The pipeline
already knows when ingestion finished, so it runs the SQL directly: errors come back on the
statement that failed, each step is logged to `pipeline_log`, and settings come from the user
profile. (On 26.9 refreshable MVs also re-run all at once after every server restart, because a
non-replicated database does not persist their refresh state.) The one MV kept is the
insert-triggered `scheme_nav_bounds_ins`, which maintains each scheme's newest NAV incrementally
for the ingester. Small rollups that are cheap to compute on demand (`category_stats`,
`fund_house_stats`, `fund_metrics_long`, `fund_ranks_latest`) are plain views, so they are always
consistent with the tables they read.

Two details keep this safe. `CREATE TABLE ... AS SELECT` and `INSERT ... SELECT` match columns by
position, so before each statement the refresh checks that the query's column names equal the
table's and fails otherwise. Raw NAVs are read with `FROM nav FINAL`, which applies the
ReplacingMergeTree's latest-ingest-wins rule at read time (much faster than a `GROUP BY`).

A full rebuild over ~35M NAV rows takes about 2 minutes, most of it `fund_risk`. Peak memory per
query stays under ~1.5 GB, so it runs on a host where ClickHouse gets ~2.5 GB: the default user
profile (`docker/clickhouse/users.d/mf.xml`) spills sorts and aggregations to disk past 200 MB.
Rolling returns use a RANGE window frame over a calendar key instead of an ASOF join (1.1 GB
instead of 2.7 GB).

### Tables

| Table | Grain | Contents |
|---|---|---|
| `scheme_info` | scheme | Canonical SEBI category, plan (Direct/Regular), option (Growth/IDCW/Bonus), IDCW frequency, coverage, active flag, peer eligibility |
| `scheme_siblings` | scheme × relation | Direct↔Regular plan and IDCW→Growth option of the same scheme |
| `nav_clean` | scheme × date | Deduplicated NAVs, glitches removed, restated across unit changes (`raw_nav` keeps the published NAV), previous NAV and return |
| `nav_glitches` | scheme × date | One-day spikes that the next NAV reverses (excluded from analytics) |
| `nav_adjustments` | scheme × date | Face-value changes and ETF unit splits (one-day ≥75% moves within ~4.7% of a factor such as ×10, ×100, 1:5, 1:50); earlier NAVs are restated by the factor |
| `category_index` | category × plan × date | Equal-weighted category index (no survivorship bias) |
| `benchmark_daily` | key × calendar day | Forward-filled levels: category indices, index-fund proxies, risk-free |
| `fund_daily`, `fund_monthly` | scheme × day / month | Returns with risk-free, category and index returns over the same interval |
| `fund_returns` | scheme × horizon | 1D, 1W, 1M, 3M, 6M, YTD, FYTD, 1Y, 2Y, 3Y, 5Y, 7Y, 10Y, 15Y, 20Y, SI: absolute and CAGR |
| `fund_period_returns` | scheme × period | Every month, quarter, calendar year and financial year |
| `fund_risk` | scheme × basis × window | CAGR, volatility, downside deviation, Sharpe, Sortino, Calmar, Omega, skew, excess kurtosis, VaR/CVaR (daily 1Y/3Y/5Y and monthly), best/worst period, max drawdown with peak/trough/recovery, Ulcer index, time under water |
| `fund_drawdowns` | scheme × rank | Five deepest drawdown episodes since inception |
| `fund_relative` | scheme × basis × window × benchmark | Beta, alpha, R², tracking error, information ratio, Treynor, M², up/down capture, batting average |
| `fund_rolling` | scheme × 1Y/3Y/5Y/10Y | Rolling-return distribution, % above 7/10/12/15%, % of periods beating the category |
| `fund_sip` | scheme × tenure | Monthly SIP invested, units, value, gain, XIRR |
| `idcw_events` | scheme × date | IDCW payouts inferred from the Growth sibling |
| `data_quality` | scheme | Gaps, glitches, largest moves, payouts |
| `fund_metrics` | scheme | ~130 headline columns: the screener table. `return_basis` is `total` for Growth options and `price` for IDCW/Bonus options |
| `fund_ranks` (+ view `fund_ranks_latest`) | date × metric × scheme | Rank, peers, percentile, quartile within category × plan; history kept (stored table, appended by every refresh) |
| `category_stats` (view) | category × plan × metric | Mean, median, quartiles, best/worst fund |
| `fund_house_stats` (view) | fund house | Schemes, ranked funds, average percentile, % in top quartile |

### Conventions

Formulas follow Morningstar's published methodology, which Value Research uses for Indian funds:

* **Returns**: "N years ago" is the nearest NAV on or before that date. Absolute return up to 1 year,
  CAGR beyond. A window the fund didn't fully exist for is left NULL, never extrapolated.
* **Risk** is computed on two bases. *Monthly* (month-end NAVs, complete months, ×√12) is
  comparable with Morningstar and Value Research. *Daily* uses NAV-to-NAV returns, annualised by
  the observed NAVs per year: about 248 for equity funds, about 365 for liquid funds that publish
  every day.
* **Sharpe** = mean(R − Rf) / stdev(R − Rf) × √ppy. **Sortino** uses the downside deviation of
  excess returns over all periods. **Alpha/beta** come from a regression of fund excess returns on
  benchmark excess returns. **Capture ratios** are annualised geometric returns in periods where the
  benchmark is ≥ 0 (up; Morningstar Direct's definition) or < 0 (down). The **up/down percentage
  ratios** count periods the fund beat a benchmark that rose (> 0) or fell (< 0); flat periods are
  neither. **Batting average** counts periods the fund beat or matched the benchmark.
  **Calmar** = CAGR / |max drawdown|. **Skewness** and **excess kurtosis** are Excel's SKEW and
  KURT (adjusted Fisher-Pearson estimators). **Gain/loss ratio** = total gains / total losses.
* **Windows** are omitted rather than approximated: a daily window needs a base NAV within 10 days
  of its start (no stale price across a data gap), a monthly window needs every month, and
  monthly SI needs contiguous months. A month (or quarter, year, financial year) counts as complete
  once the market's as-of date reaches its last calendar day.
* **Drawdowns**: the peak is the latest date at the running high; recovery is the first later
  date the NAV is back at or above it. Medians and quartiles interpolate (Excel PERCENTILE.INC).
* **Risk-free rate**: the daily NAV of SBI Liquid Fund Direct (it holds paper of up to 91 days, so
  it tracks the 91-day T-bill that Value Research uses). Before 2013 a 6.85% fallback applies (the
  median 91-day T-bill yield since 1995).
* **Benchmarks**: (1) the equal-weighted category index, and (2) an index fund tracking the
  category's [AMFI tier-1 benchmark](https://www.business-standard.com/article/markets/amfi-lists-first-tier-benchmarks-for-mutual-fund-schemes-122033101156_1.html)
  (e.g. Large Cap → Nifty 100). Proxies trail the TRI by roughly their expense ratio (0.1–0.3%).
  The category index is built on index dates (at least 3 funds and half the month's busiest day
  published); each fund's return runs between consecutive index dates on which it has a NAV, so
  a missed day or a rejected thin day never turns into a one-day catch-up move. Benchmark levels
  are carried forward at most 7 days; after that the benchmark is missing and no relative
  statistics are reported against it.
* **Categories** follow SEBI's circular of 26 Feb 2026. AMCs report category labels in different
  formats (`Equity Scheme - Large Cap Fund` vs `Equity Schemes - Large Cap Fund`, old "Duration"
  vs new "Term" debt names); `config/categories.csv` maps all 104 labels seen to one canonical
  category.
* **Peer groups** are category × plan, active Growth options of open-ended schemes, excluding
  legacy share classes (Retail/Institutional) and index funds, ETFs and FoFs. **Percentile** is the
  share of the other peers a fund strictly beats (ties earn no credit); **quartile** follows
  Morningstar (percentile rank 1 = best, quartile = ⌈rank/25⌉), so the best fund is always Q1.
* **SIP**: a fixed installment on the first NAV of each month, valued at the latest NAV; XIRR by
  ClickHouse's native `financialInternalRateOfReturnExtended` (Excel XIRR, ACT/365F).

### Limitations (inherent to NAV-only data)

* No AUM, expense ratio, holdings, sector mix, P/E, YTM/duration, exit loads or fund managers.
* IDCW plans' returns exclude payouts (`return_basis = 'price'`). They are computed and labelled
  but not ranked; for total return use the Growth sibling (`growth_option_code`), which runs the same
  portfolio. Payouts are inferred from the Growth sibling where one exists. `idcw_yield_1y` is
  trailing payouts per unit ÷ current NAV.
* Category history uses each fund's *current* category, including for years before SEBI's 2018
  recategorisation.
* `inception_date` is the first NAV mfapi has (AMFI data starts April 2006), not the legal launch
  date.
* Unit changes are recognised only when the jump is close to a split factor; a redenomination by
  another ratio (or a 1:2 split, indistinguishable from a −50% move) is not adjusted and shows in
  `data_quality.moves_over_10pct`.

## Configuration

* `config/settings.toml`: risk-free proxy and fallback rate, SIP amount, activity window, glitch
  and payout thresholds, and the category → index-fund proxy list.
* `config/categories.csv`: raw AMFI category label → asset class, canonical category, rankable.

Both are loaded into ClickHouse on every run, so edits take effect at the next run.

## Development

No local Rust toolchain is needed; `./dev.sh` runs cargo in the official image on the compose
network.

```bash
docker compose up -d clickhouse redis
./dev.sh test --release --workspace   # unit tests, end-to-end SQL test (mf_test), API test (mf_api_test)
./dev.sh run --release -- daily
```

`src/testing.rs` builds synthetic funds with closed-form answers. `tests/pipeline.rs` checks the
SQL produces them: exact CAGR, SIP XIRR equal to the growth rate, beta = 1.5 and alpha = 0 by
construction, known drawdown dates, a 5% IDCW payout, a glitch day, a too-young fund (no
multi-year rows), a data gap (stale-start window dropped) and a ×100 face-value change. Edge-case funds (`seed_edge_cases`) pin
skewness/kurtosis, the gain/loss ratio without gains, the category index across a missed day and
a rejected thin day, peer percentiles with ties and quartiles, period completeness, the up
percentage ratio with flat benchmark periods and a benchmark that stops publishing.
`api/tests/api.rs` builds the real router on the same data and checks the HTTP layer: search,
detail, calculators, screener filters and sorting, problem+json errors, caching and 304s.

The metrics were also checked against an independent Python recomputation straight from the
mfapi API (no shared code) for three real funds: trailing returns, daily and monthly
volatility/Sharpe/Sortino, max drawdown with dates, beta/alpha/tracking error/up-capture against
the index proxy, SIP XIRR and rolling medians. All 69 checks matched to floating-point precision.

To add or change a metric, edit or add a file in `sql/derived/` (the number sets its place in the
order; it may only read objects from files with lower numbers) and run `mf refresh`. Only changes
to the stored tables need a new migration in `sql/migrations/`.
