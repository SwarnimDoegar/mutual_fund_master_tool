# Mutual fund analytics pipeline

Pulls every Indian mutual fund NAV from [mfapi.in](https://www.mfapi.in/) into ClickHouse once a
day and computes about 250 metrics per scheme (returns, rolling returns, SIP XIRR, risk,
drawdowns, benchmark-relative statistics, peer ranks) as **ClickHouse refreshable materialized
views**. The Rust service only ingests data and tells ClickHouse when to recompute.

This is the data layer for a public fund-research product; a REST API and web UI are separate
projects that read these tables.

```
mfapi.in ──► mf (Rust) ──► ClickHouse
             ingest          raw:      schemes, nav (ReplacingMergeTree, idempotent)
             refresh ──────► derived:  22 refreshable MVs, recomputed in dependency order
```

## Quick start

```bash
docker compose up -d            # ClickHouse + the mf scheduler
docker compose logs -f mf       # first start backfills all ~38k schemes (~7 min), then computes metrics (~75 s)
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

## Commands

| Command | What it does |
|---|---|
| `mf run` | Default container command. Migrates, backfills if never run, then runs `daily` on `MF_SCHEDULE`. |
| `mf daily` | migrate → sync-config → ingest → refresh, logged to `pipeline_log` under one run id. |
| `mf ingest [--codes 1,2] [--full] [--snapshot-only]` | Fetch NAVs only. |
| `mf refresh [--from VIEW] [--only V1,V2]` | Recompute views in dependency order. |
| `mf migrate`, `mf sync-config`, `mf status` | Schema, config tables, recent runs + view status. |

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

All metrics are SQL in `sql/migrations/`. Every derived table is fed by a refreshable
materialized view `<table>_mv` that re-runs its full query and atomically swaps the result.
`mf refresh` triggers them in the order in `src/refresh.rs::REFRESH_ORDER` and verifies each one
actually refreshed. Two ClickHouse behaviours (verified on 26.9) make that necessary: a manual
`SYSTEM REFRESH VIEW` does not cascade to `DEPENDS ON` children, and a stopped view silently
ignores `SYSTEM REFRESH VIEW` while `SYSTEM WAIT VIEW` still succeeds. The views' own schedule is
a nominal yearly one.

A full recompute over ~35M NAV rows takes about 80 s. Peak memory per view stays under ~1.7 GB, so
it runs on a host where ClickHouse gets ~3.5 GB. The heavy views spill sorts and aggregations to
disk early and cap their own threads (in their SQL, because background refreshes don't pick up
profile changes made after server start). Rolling returns use a RANGE window frame over a calendar
key instead of an ASOF join (1.1 GB instead of 2.7 GB). The orchestrator also purges allocator
memory between views.

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
| `fund_ranks` (+ view `fund_ranks_latest`) | date × metric × scheme | Rank, peers, percentile, quartile within category × plan; history kept |
| `category_stats` | category × plan × metric | Mean, median, quartiles, best/worst fund |
| `fund_house_stats` | fund house | Schemes, ranked funds, average percentile, % in top quartile |

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
  benchmark is ≥ 0 (up; Morningstar Direct's definition) or < 0 (down). **Batting average** counts
  periods the fund beat or matched the benchmark. **Calmar** = CAGR / |max drawdown|.
* **Windows** are omitted rather than approximated: a daily window needs a base NAV within 10 days
  of its start (no stale price across a data gap), a monthly window needs every month, and
  monthly SI needs contiguous months. A month counts once the market's as-of date reaches its
  last calendar day.
* **Drawdowns**: the peak is the latest date at the running high; recovery is the first later
  date the NAV is back at or above it. Medians and quartiles interpolate (Excel PERCENTILE.INC).
* **Risk-free rate**: the daily NAV of SBI Liquid Fund Direct (it holds paper of up to 91 days, so
  it tracks the 91-day T-bill that Value Research uses). Before 2013 a 6.85% fallback applies (the
  median 91-day T-bill yield since 1995).
* **Benchmarks**: (1) the equal-weighted category index, and (2) an index fund tracking the
  category's [AMFI tier-1 benchmark](https://www.business-standard.com/article/markets/amfi-lists-first-tier-benchmarks-for-mutual-fund-schemes-122033101156_1.html)
  (e.g. Large Cap → Nifty 100). Proxies trail the TRI by roughly their expense ratio (0.1–0.3%).
* **Categories** follow SEBI's circular of 26 Feb 2026. AMCs report category labels in different
  formats (`Equity Scheme - Large Cap Fund` vs `Equity Schemes - Large Cap Fund`, old "Duration"
  vs new "Term" debt names); `config/categories.csv` maps all 104 labels seen to one canonical
  category.
* **Peer groups** are category × plan, active Growth options of open-ended schemes, excluding
  legacy share classes (Retail/Institutional) and index funds, ETFs and FoFs.
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
docker compose up -d clickhouse
./dev.sh test --release        # unit tests + end-to-end SQL test (database mf_test)
./dev.sh run --release -- daily
```

`tests/pipeline.rs` builds synthetic funds with closed-form answers and checks the SQL produces
them: exact CAGR, SIP XIRR equal to the growth rate, beta = 1.5 and alpha = 0 by construction,
known drawdown dates, a 5% IDCW payout, a glitch day, a too-young fund (no multi-year rows) and a
data gap (stale-start window dropped).

The metrics were also checked against an independent Python recomputation straight from the
mfapi API (no shared code) for three real funds: trailing returns, daily and monthly
volatility/Sharpe/Sortino, max drawdown with dates, beta/alpha/tracking error/up-capture against
the index proxy, SIP XIRR and rolling medians. All 69 checks matched to floating-point precision.

To add or change a metric: add a new numbered migration (applied migrations are checksummed and
must not be edited), then add any new view to `REFRESH_ORDER`. `mf refresh` refuses to run if the
list and the database disagree.
