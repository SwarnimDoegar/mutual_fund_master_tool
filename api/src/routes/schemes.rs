//! `/v1/schemes/...`: search, scheme detail and per-scheme metric families.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Map, Value};
use utoipa::IntoParams;

use super::{ApiPath, ApiQuery, BUCKET, DocQuery, Interval, Paging, many, one, take_total};
use crate::db::Row;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/schemes", get(search_schemes))
        .route("/schemes/{code}", get(get_scheme))
        .route("/schemes/{code}/nav", get(get_nav))
        .route("/schemes/{code}/returns", get(get_returns))
        .route("/schemes/{code}/calendar-returns", get(get_calendar_returns))
        .route("/schemes/{code}/risk", get(get_risk))
        .route("/schemes/{code}/relative", get(get_relative))
        .route("/schemes/{code}/rolling", get(get_rolling))
        .route("/schemes/{code}/rolling/{period}", get(get_rolling_series))
        .route("/schemes/{code}/sip", get(get_sip))
        .route("/schemes/{code}/sip/calculate", get(calculate_sip))
        .route("/schemes/{code}/lumpsum/calculate", get(calculate_lumpsum))
        .route("/schemes/{code}/drawdowns", get(get_drawdowns))
        .route("/schemes/{code}/drawdowns/series", get(get_drawdown_series))
        .route("/schemes/{code}/ranks", get(get_ranks))
        .route("/schemes/{code}/payouts", get(get_payouts))
        .route("/schemes/{code}/quality", get(get_quality))
}

const MIN_DATE: &str = "1970-01-01";
const MAX_DATE: &str = "2149-06-06";

async fn exists(state: &AppState, code: u32) -> ApiResult<bool> {
    Ok(state
        .db
        .sql("SELECT 1 AS x FROM scheme_info WHERE scheme_code = {code:UInt32}")
        .param("code", code)
        .one()
        .await?
        .is_some())
}

/// Rows for a scheme sub-resource; 404 when the scheme itself is unknown.
async fn scheme_rows(state: &AppState, code: u32, rows: Vec<Row>) -> ApiResult<Vec<Row>> {
    if rows.is_empty() && !exists(state, code).await? {
        return Err(ApiError::NotFound(format!("scheme {code} not found")));
    }
    Ok(rows)
}

fn date_or(d: Option<NaiveDate>, default: &str) -> String {
    d.map(|d| d.to_string()).unwrap_or_else(|| default.to_string())
}

// ---------------------------------------------------------------------------------------------
// Search

const LIST_COLUMNS: &str = "scheme_code, scheme_name, fund_house, asset_class, category, plan, option, return_basis, \
     is_active, peer_eligible, inception_date, last_nav_date, last_nav, ret_1y, cagr_3y, cagr_5y";

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct SearchParams {
    /// Words that must all appear in the scheme or fund house name; a number matches the scheme code.
    q: Option<String>,
    /// Canonical SEBI category, e.g. `Flexi Cap Fund`.
    category: Option<String>,
    asset_class: Option<String>,
    fund_house: Option<String>,
    /// `Direct` or `Regular`.
    plan: Option<String>,
    /// `Growth`, `IDCW` or `Bonus`.
    option: Option<String>,
    /// Only schemes with a recent NAV.
    active: Option<bool>,
    /// Page size (1-500, default 50).
    limit: Option<u32>,
    /// Rows to skip.
    offset: Option<u32>,
}

/// Search and list schemes.
///
/// Matches every word of `q` against the scheme and fund-house name (case-insensitive).
/// Results favour active schemes and Direct Growth plans.
#[utoipa::path(get, path = "/v1/schemes", operation_id = "search_schemes", tag = "schemes",
    params(SearchParams), responses((status = 200, description = "Matching schemes")))]
pub async fn search_schemes(
    State(state): State<AppState>,
    ApiQuery(p): ApiQuery<SearchParams>,
) -> ApiResult<Json<Value>> {
    let (limit, offset) = Paging { limit: p.limit, offset: p.offset }.resolve(50)?;
    let mut conds: Vec<String> = vec![];
    let mut params: Vec<(String, String)> = vec![];

    let mut tokens: Vec<String> = vec![];
    let mut code_match: Option<u32> = None;
    if let Some(text) = p.q.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        if text.len() > 200 {
            return Err(ApiError::bad("q is too long"));
        }
        if let Ok(code) = text.parse::<u32>() {
            code_match = Some(code);
        } else {
            tokens = text.split_whitespace().map(str::to_string).collect();
            if tokens.len() > 8 {
                return Err(ApiError::bad("q may contain at most 8 words"));
            }
        }
    }
    for (i, _) in tokens.iter().enumerate() {
        conds.push(format!("positionCaseInsensitiveUTF8(concat(scheme_name, ' ', fund_house), {{t{i}:String}}) > 0"));
    }
    if code_match.is_some() {
        conds.push("scheme_code = {code:UInt32}".into());
    }
    for (field, value) in [
        ("category", &p.category),
        ("asset_class", &p.asset_class),
        ("fund_house", &p.fund_house),
        ("plan", &p.plan),
        ("option", &p.option),
    ] {
        if let Some(v) = value {
            conds.push(format!("{field} = {{{field}:String}}"));
            params.push((field.to_string(), v.clone()));
        }
    }
    if let Some(active) = p.active {
        conds.push(format!("is_active = {}", u8::from(active)));
    }
    let where_sql = if conds.is_empty() { "1".to_string() } else { conds.join(" AND ") };
    let order = if tokens.is_empty() {
        "scheme_name"
    } else {
        "is_active DESC, (plan = 'Direct' AND option = 'Growth') DESC, length(scheme_name), scheme_name"
    };
    let sql = format!(
        "SELECT {LIST_COLUMNS}, count() OVER () AS total FROM fund_metrics WHERE {where_sql}
         ORDER BY {order} LIMIT {{limit:UInt32}} OFFSET {{offset:UInt32}}"
    );
    let bind = |mut q: crate::db::Query| {
        for (i, t) in tokens.iter().enumerate() {
            q = q.param(&format!("t{i}"), t);
        }
        if let Some(code) = code_match {
            q = q.param("code", code);
        }
        for (name, value) in &params {
            q = q.param(name, value);
        }
        q
    };
    let mut rows = bind(state.db.sql(&sql).param("limit", limit).param("offset", offset)).rows().await?;
    let mut total = take_total(&mut rows);
    if rows.is_empty() && offset > 0 {
        // page past the end: the window count went with the rows
        let count_sql = format!("SELECT count() AS total FROM fund_metrics WHERE {where_sql}");
        let row = bind(state.db.sql(&count_sql)).one().await?;
        total = row.and_then(|r| r.get("total").and_then(Value::as_u64)).unwrap_or(0);
    }
    let mut extra = Map::new();
    extra.insert("total".into(), total.into());
    extra.insert("limit".into(), limit.into());
    extra.insert("offset".into(), offset.into());
    Ok(many(&state, rows, extra))
}

// ---------------------------------------------------------------------------------------------
// Detail

const SCHEME_SQL: &str = "
SELECT m.*,
       i.raw_category AS raw_category, i.isin_growth AS isin_growth,
       i.isin_div_reinvestment AS isin_div_reinvestment, i.nav_count AS nav_count,
       i.is_legacy_plan AS is_legacy_plan
FROM fund_metrics AS m
INNER JOIN scheme_info AS i ON i.scheme_code = m.scheme_code
WHERE m.scheme_code = {code:UInt32}";

/// Everything headline about one scheme: identity, trailing returns, risk, benchmark-relative
/// statistics, rolling and SIP returns, siblings and data quality (the `fund_metrics` row).
#[utoipa::path(get, path = "/v1/schemes/{code}", operation_id = "get_scheme", tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code")),
    responses((status = 200, description = "Scheme"), (status = 404, description = "Unknown scheme")))]
pub async fn get_scheme(State(state): State<AppState>, ApiPath(code): ApiPath<u32>) -> ApiResult<Json<Value>> {
    let row = state.db.sql(SCHEME_SQL).param("code", code).one().await?;
    let row = row.ok_or_else(|| ApiError::NotFound(format!("scheme {code} not found")))?;
    Ok(one(&state, row))
}

// ---------------------------------------------------------------------------------------------
// NAV history

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct SeriesParams {
    /// First date (inclusive), YYYY-MM-DD.
    from: Option<NaiveDate>,
    /// Last date (inclusive), YYYY-MM-DD.
    to: Option<NaiveDate>,
    /// `day` (default), `week` or `month`: the last value of each period.
    #[serde(default)]
    interval: Interval,
}

fn nav_sql() -> String {
    format!(
        "SELECT max(date) AS date, argMax(nav, date) AS nav, argMax(raw_nav, date) AS published_nav
         FROM nav_clean
         WHERE scheme_code = {{code:UInt32}} AND date BETWEEN {{from:Date}} AND {{to:Date}}
         GROUP BY {BUCKET} AS bucket ORDER BY bucket
         SETTINGS prefer_column_name_to_alias = 1"
    )
}

/// NAV history, optionally down-sampled to weekly or monthly closes.
///
/// `nav` is restated across face-value changes and unit splits (comparable over time, use it for
/// charts and returns); `published_nav` is the NAV as declared on that date. One-day data-entry
/// spikes are removed.
#[utoipa::path(get, path = "/v1/schemes/{code}/nav", operation_id = "get_nav", tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code"), SeriesParams),
    responses((status = 200, description = "NAV series")))]
pub async fn get_nav(
    State(state): State<AppState>,
    ApiPath(code): ApiPath<u32>,
    ApiQuery(p): ApiQuery<SeriesParams>,
) -> ApiResult<Json<Value>> {
    let rows = state
        .db
        .sql(&nav_sql())
        .param("code", code)
        .param("from", date_or(p.from, MIN_DATE))
        .param("to", date_or(p.to, MAX_DATE))
        .param("interval", p.interval.as_str())
        .rows()
        .await?;
    let rows = scheme_rows(&state, code, rows).await?;
    Ok(many(&state, rows, Map::new()))
}

// ---------------------------------------------------------------------------------------------
// Simple per-scheme tables

const RETURNS_SQL: &str = "
SELECT horizon, start_date, start_nav, end_date, end_nav, years, abs_return, cagr
FROM fund_returns WHERE scheme_code = {code:UInt32} ORDER BY horizon_order";

/// Trailing returns: 1D to 20Y and since inception (absolute, and CAGR beyond one year).
#[utoipa::path(get, path = "/v1/schemes/{code}/returns", operation_id = "get_returns", tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code")),
    responses((status = 200, description = "Trailing returns")))]
pub async fn get_returns(State(state): State<AppState>, ApiPath(code): ApiPath<u32>) -> ApiResult<Json<Value>> {
    simple(&state, code, RETURNS_SQL, &[]).await
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct CalendarParams {
    /// `month`, `quarter`, `year` or `fy` (April-March); all when omitted.
    period: Option<String>,
}

const CALENDAR_SQL: &str = "
SELECT period_type, period_start, start_date, start_nav, end_date, end_nav, ret, is_partial
FROM fund_period_returns
WHERE scheme_code = {code:UInt32} AND ({period:String} = '' OR period_type = {period:String})
ORDER BY period_type, period_start";

/// Monthly, quarterly, calendar-year and financial-year returns.
#[utoipa::path(get, path = "/v1/schemes/{code}/calendar-returns", operation_id = "get_calendar_returns",
    tag = "schemes", params(("code" = u32, Path, description = "AMFI scheme code"), CalendarParams),
    responses((status = 200, description = "Period returns")))]
pub async fn get_calendar_returns(
    State(state): State<AppState>,
    ApiPath(code): ApiPath<u32>,
    ApiQuery(p): ApiQuery<CalendarParams>,
) -> ApiResult<Json<Value>> {
    let period = p.period.unwrap_or_default();
    one_of(&period, &["", "month", "quarter", "year", "fy"], "period")?;
    simple(&state, code, CALENDAR_SQL, &[("period", period)]).await
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct BasisParams {
    /// `daily` or `monthly` (Morningstar/Value Research comparable); both when omitted.
    basis: Option<String>,
    /// For /relative: `category` or `index`; both when omitted.
    benchmark: Option<String>,
}

const RISK_SQL: &str = "
SELECT * EXCEPT scheme_code FROM fund_risk
WHERE scheme_code = {code:UInt32} AND ({basis:String} = '' OR basis = {basis:String})
ORDER BY basis, indexOf(['1Y', '3Y', '5Y', '10Y', 'SI'], period)";

/// Risk, return and drawdown statistics per basis and window (1Y, 3Y, 5Y, 10Y, SI).
#[utoipa::path(get, path = "/v1/schemes/{code}/risk", operation_id = "get_risk", tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code"), BasisParams),
    responses((status = 200, description = "Risk statistics")))]
pub async fn get_risk(
    State(state): State<AppState>,
    ApiPath(code): ApiPath<u32>,
    ApiQuery(p): ApiQuery<BasisParams>,
) -> ApiResult<Json<Value>> {
    let basis = p.basis.unwrap_or_default();
    one_of(&basis, &["", "daily", "monthly"], "basis")?;
    simple(&state, code, RISK_SQL, &[("basis", basis)]).await
}

const RELATIVE_SQL: &str = "
SELECT r.* EXCEPT scheme_code,
       if(r.benchmark = 'category', concat(i.category, ' (', i.plan, ') category average'), bp.index_name) AS benchmark_name
FROM fund_relative AS r
INNER JOIN scheme_info AS i ON i.scheme_code = r.scheme_code
LEFT JOIN benchmark_proxy AS bp ON bp.category = i.category
WHERE r.scheme_code = {code:UInt32}
  AND ({basis:String} = '' OR r.basis = {basis:String})
  AND ({benchmark:String} = '' OR r.benchmark = {benchmark:String})
ORDER BY r.benchmark, r.basis, indexOf(['1Y', '3Y', '5Y'], r.period)";

/// Beta, alpha, R², tracking error, information ratio and capture ratios against the category
/// average and the category's index-fund proxy.
#[utoipa::path(get, path = "/v1/schemes/{code}/relative", operation_id = "get_relative", tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code"), BasisParams),
    responses((status = 200, description = "Benchmark-relative statistics")))]
pub async fn get_relative(
    State(state): State<AppState>,
    ApiPath(code): ApiPath<u32>,
    ApiQuery(p): ApiQuery<BasisParams>,
) -> ApiResult<Json<Value>> {
    let basis = p.basis.unwrap_or_default();
    let benchmark = p.benchmark.unwrap_or_default();
    one_of(&basis, &["", "daily", "monthly"], "basis")?;
    one_of(&benchmark, &["", "category", "index"], "benchmark")?;
    simple(&state, code, RELATIVE_SQL, &[("basis", basis), ("benchmark", benchmark)]).await
}

const ROLLING_SQL: &str = "
SELECT * EXCEPT scheme_code FROM fund_rolling WHERE scheme_code = {code:UInt32} ORDER BY years";

/// Rolling-return distribution for 1Y, 3Y, 5Y and 10Y windows (daily steps).
#[utoipa::path(get, path = "/v1/schemes/{code}/rolling", operation_id = "get_rolling", tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code")),
    responses((status = 200, description = "Rolling-return summaries")))]
pub async fn get_rolling(State(state): State<AppState>, ApiPath(code): ApiPath<u32>) -> ApiResult<Json<Value>> {
    simple(&state, code, ROLLING_SQL, &[]).await
}

const SIP_SQL: &str = "
SELECT * EXCEPT scheme_code FROM fund_sip WHERE scheme_code = {code:UInt32} ORDER BY tenure_order";

/// Monthly SIP outcomes for standard tenures (installment on the first NAV of each month).
#[utoipa::path(get, path = "/v1/schemes/{code}/sip", operation_id = "get_sip", tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code")),
    responses((status = 200, description = "SIP outcomes")))]
pub async fn get_sip(State(state): State<AppState>, ApiPath(code): ApiPath<u32>) -> ApiResult<Json<Value>> {
    simple(&state, code, SIP_SQL, &[]).await
}

const DRAWDOWNS_SQL: &str = "
SELECT * EXCEPT scheme_code FROM fund_drawdowns WHERE scheme_code = {code:UInt32} ORDER BY rank";

/// The five deepest drawdowns since inception, with peak, trough and recovery dates.
#[utoipa::path(get, path = "/v1/schemes/{code}/drawdowns", operation_id = "get_drawdowns", tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code")),
    responses((status = 200, description = "Drawdown episodes")))]
pub async fn get_drawdowns(State(state): State<AppState>, ApiPath(code): ApiPath<u32>) -> ApiResult<Json<Value>> {
    simple(&state, code, DRAWDOWNS_SQL, &[]).await
}

const PAYOUTS_SQL: &str = "
SELECT date, growth_code, idcw_ret, growth_ret, payout_per_unit, payout_pct
FROM idcw_events WHERE scheme_code = {code:UInt32} ORDER BY date DESC";

/// IDCW payouts inferred from the gap to the Growth option of the same scheme.
#[utoipa::path(get, path = "/v1/schemes/{code}/payouts", operation_id = "get_payouts", tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code")),
    responses((status = 200, description = "Inferred payouts")))]
pub async fn get_payouts(State(state): State<AppState>, ApiPath(code): ApiPath<u32>) -> ApiResult<Json<Value>> {
    simple(&state, code, PAYOUTS_SQL, &[]).await
}

const QUALITY_SQL: &str = "SELECT * FROM data_quality WHERE scheme_code = {code:UInt32}";

/// Data-quality profile: gaps, removed glitches, largest moves.
#[utoipa::path(get, path = "/v1/schemes/{code}/quality", operation_id = "get_quality", tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code")),
    responses((status = 200, description = "Data quality"), (status = 404, description = "Unknown scheme")))]
pub async fn get_quality(State(state): State<AppState>, ApiPath(code): ApiPath<u32>) -> ApiResult<Json<Value>> {
    let row = state.db.sql(QUALITY_SQL).param("code", code).one().await?;
    let row = row.ok_or_else(|| ApiError::NotFound(format!("scheme {code} not found")))?;
    Ok(one(&state, row))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct RankParams {
    /// Return the history of this metric (e.g. `cagr_3y`) instead of the latest ranks.
    metric: Option<String>,
    /// History start date.
    from: Option<NaiveDate>,
}

const RANKS_LATEST_SQL: &str = "
SELECT metric, value, rank, peers, percentile, quartile, category, plan, as_of_date
FROM fund_ranks_latest WHERE scheme_code = {code:UInt32} ORDER BY metric";

const RANKS_HISTORY_SQL: &str = "
SELECT as_of_date, value, rank, peers, percentile, quartile
FROM fund_ranks FINAL
WHERE scheme_code = {code:UInt32} AND metric = {metric:String} AND as_of_date >= {from:Date}
ORDER BY as_of_date";

/// Peer ranks within category × plan: latest for every metric, or one metric's daily history.
#[utoipa::path(get, path = "/v1/schemes/{code}/ranks", operation_id = "get_ranks", tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code"), RankParams),
    responses((status = 200, description = "Ranks")))]
pub async fn get_ranks(
    State(state): State<AppState>,
    ApiPath(code): ApiPath<u32>,
    ApiQuery(p): ApiQuery<RankParams>,
) -> ApiResult<Json<Value>> {
    let rows = match &p.metric {
        None => state.db.sql(RANKS_LATEST_SQL).param("code", code).rows().await?,
        Some(metric) => {
            state
                .db
                .sql(RANKS_HISTORY_SQL)
                .param("code", code)
                .param("metric", metric)
                .param("from", date_or(p.from, MIN_DATE))
                .rows()
                .await?
        }
    };
    let rows = scheme_rows(&state, code, rows).await?;
    Ok(many(&state, rows, Map::new()))
}

// ---------------------------------------------------------------------------------------------
// Series computed on request (one scheme's data, so cheap)

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct RollingSeriesParams {
    /// First window end date (inclusive), YYYY-MM-DD.
    from: Option<NaiveDate>,
    /// Last window end date (inclusive), YYYY-MM-DD.
    to: Option<NaiveDate>,
    /// `day`, `week` (default) or `month`: the last value of each period.
    interval: Option<Interval>,
}

/// Rolling returns: start NAV via a RANGE frame over k = year*372 + (month-1)*31 + (day-1), the
/// same technique and tolerances as the fund_rolling view. `{frame}` is a validated integer.
fn rolling_series_sql(frame: u32) -> String {
    format!(
        "WITH {{years:UInt8}} AS y
        SELECT max(date) AS date, argMax(fund_return, date) AS fund_return,
               argMax(tuple(category_return), date).1 AS category_return
        FROM
        (
            SELECT r.date AS date, r.rr AS fund_return,
                   pow(c1.level / c0.level, 1 / y) - 1 AS category_return
            FROM
            (
                SELECT date, start_date, pow(nav / start_nav, 1 / y) - 1 AS rr
                FROM
                (
                    SELECT date, nav,
                           toYear(date) * 372 + (toMonth(date) - 1) * 31 + (toDayOfMonth(date) - 1) AS k,
                           last_value(nav) OVER w AS start_nav, last_value(date) OVER w AS start_date
                    FROM nav_clean WHERE scheme_code = {{code:UInt32}}
                    WINDOW w AS (ORDER BY k RANGE BETWEEN UNBOUNDED PRECEDING AND {frame} PRECEDING)
                )
                WHERE start_nav > 0 AND dateDiff('day', start_date, addYears(date, -toInt32(y))) <= 10
                  AND date BETWEEN {{from:Date}} AND {{to:Date}}
            ) AS r
            LEFT JOIN benchmark_daily AS c1 ON c1.bench_key = {{cat_key:String}} AND c1.date = r.date
            LEFT JOIN benchmark_daily AS c0 ON c0.bench_key = {{cat_key:String}} AND c0.date = r.start_date
        )
        GROUP BY {BUCKET} AS bucket ORDER BY bucket
        SETTINGS join_use_nulls = 1, prefer_column_name_to_alias = 1"
    )
}

async fn cat_key(state: &AppState, code: u32) -> ApiResult<String> {
    let row = state
        .db
        .sql("SELECT concat('cat|', category, '|', plan) AS k FROM scheme_info WHERE scheme_code = {code:UInt32}")
        .param("code", code)
        .one()
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("scheme {code} not found")))?;
    Ok(row.get("k").and_then(Value::as_str).unwrap_or_default().to_string())
}

/// Rolling-return time series for one window (`1Y`, `3Y`, `5Y`, `10Y`) next to the category
/// average's rolling return over the same dates. Defaults to weekly points.
#[utoipa::path(get, path = "/v1/schemes/{code}/rolling/{period}", operation_id = "get_rolling_series",
    tag = "schemes",
    params(("code" = u32, Path, description = "AMFI scheme code"),
           ("period" = String, Path, description = "1Y, 3Y, 5Y or 10Y"), RollingSeriesParams),
    responses((status = 200, description = "Rolling-return series")))]
pub async fn get_rolling_series(
    State(state): State<AppState>,
    ApiPath((code, period)): ApiPath<(u32, String)>,
    ApiQuery(p): ApiQuery<RollingSeriesParams>,
) -> ApiResult<Json<Value>> {
    let years: u8 = match period.to_ascii_uppercase().as_str() {
        "1Y" => 1,
        "3Y" => 3,
        "5Y" => 5,
        "10Y" => 10,
        _ => return Err(ApiError::bad("period must be 1Y, 3Y, 5Y or 10Y")),
    };
    let key = cat_key(&state, code).await?;
    let interval = p.interval.unwrap_or(Interval::Week);
    let rows = state
        .db
        .sql(&rolling_series_sql(372 * u32::from(years)))
        .param("code", code)
        .param("years", years)
        .param("cat_key", key)
        .param("from", date_or(p.from, MIN_DATE))
        .param("to", date_or(p.to, MAX_DATE))
        .param("interval", interval.as_str())
        .rows()
        .await?;
    Ok(many(&state, rows, Map::new()))
}

fn drawdown_series_sql() -> String {
    format!(
        "SELECT max(date) AS date, min(dd) AS drawdown
        FROM
        (
            SELECT date, nav / max(nav) OVER (ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) - 1 AS dd
            FROM nav_clean WHERE scheme_code = {{code:UInt32}}
        )
        WHERE date BETWEEN {{from:Date}} AND {{to:Date}}
        GROUP BY {BUCKET} AS bucket ORDER BY bucket
        SETTINGS prefer_column_name_to_alias = 1"
    )
}

/// Underwater chart: distance below the running all-time high (the worst value in each period).
#[utoipa::path(get, path = "/v1/schemes/{code}/drawdowns/series", operation_id = "get_drawdown_series",
    tag = "schemes", params(("code" = u32, Path, description = "AMFI scheme code"), SeriesParams),
    responses((status = 200, description = "Drawdown series")))]
pub async fn get_drawdown_series(
    State(state): State<AppState>,
    ApiPath(code): ApiPath<u32>,
    ApiQuery(p): ApiQuery<SeriesParams>,
) -> ApiResult<Json<Value>> {
    let rows = state
        .db
        .sql(&drawdown_series_sql())
        .param("code", code)
        .param("from", date_or(p.from, MIN_DATE))
        .param("to", date_or(p.to, MAX_DATE))
        .param("interval", p.interval.as_str())
        .rows()
        .await?;
    let rows = scheme_rows(&state, code, rows).await?;
    Ok(many(&state, rows, Map::new()))
}

// ---------------------------------------------------------------------------------------------
// Calculators

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct SipCalcParams {
    /// Installment amount (₹).
    amount: f64,
    /// First installment month, YYYY-MM.
    start: String,
    /// Last installment month, YYYY-MM (default: the month before the latest NAV).
    end: Option<String>,
    /// Day of month for installments (1-28, default 1). The installment uses the first NAV on or
    /// after that day.
    day: Option<u8>,
    /// Include the installment schedule.
    #[serde(default)]
    schedule: bool,
}

const SIP_CALC_SQL: &str = "
WITH
    {amount:Float64} AS amt,
    ifNull((SELECT max(date) FROM nav_clean WHERE scheme_code = {code:UInt32}), toDate(0)) AS v_date,
    ifNull((SELECT argMax(nav, date) FROM nav_clean WHERE scheme_code = {code:UInt32}), 0.) AS v_nav,
    -- default end: the month before the latest NAV (tied to the data, not the server clock)
    if({end:String} = '', addMonths(toStartOfMonth(v_date), -1), toDate({end:String})) AS end_month,
    inst AS
    (
        SELECT DISTINCT n.date AS date, n.nav AS nav
        FROM
        (
            SELECT 1 AS k, makeDate(toYear(m), toMonth(m), least({day:UInt8}, toDayOfMonth(toLastDayOfMonth(m)))) AS target
            FROM (SELECT addMonths({start:Date}, number) AS m
                  FROM numbers(toUInt32(greatest(dateDiff('month', {start:Date}, end_month) + 1, 0))))
        ) AS t
        ASOF INNER JOIN (SELECT 1 AS k, date, nav FROM nav_clean WHERE scheme_code = {code:UInt32}) AS n
            ON n.k = t.k AND n.date >= t.target
        -- skip months the fund didn't exist in (the next NAV would be far away)
        WHERE dateDiff('day', t.target, n.date) <= 10 AND n.date <= v_date
    )
SELECT
    toUInt32(count()) AS installments,
    min(date) AS first_installment,
    max(date) AS last_installment,
    amt * count() AS invested,
    sum(amt / nav) AS units,
    any(v_date) AS value_date,
    any(v_nav) AS value_nav,
    units * value_nav AS current_value,
    current_value - invested AS gain,
    if(invested > 0, current_value / invested - 1, NULL) AS abs_return,
    -- cash flows on the same date (last installment on the valuation date) are netted
    arrayReduce('sumMap', [arrayConcat(groupArray(date), [any(v_date)])],
                         [arrayConcat(groupArray(-amt), [current_value])]) AS flows,
    -- needs at least two distinct cash-flow dates (one installment before the valuation date is enough)
    if(length(flows.1) >= 2, financialInternalRateOfReturnExtended(flows.2, flows.1), NULL) AS irr,
    if(isFinite(irr), irr, NULL) AS xirr,
    if({schedule:UInt8}, arraySort(x -> x.date,
        groupArray(CAST((date, nav, amt / nav), 'Tuple(date Date, nav Float64, units Float64)'))), []) AS schedule
FROM inst";

/// What a monthly SIP over a chosen period would be worth today, with XIRR.
#[utoipa::path(get, path = "/v1/schemes/{code}/sip/calculate", operation_id = "calculate_sip", tag = "calculators",
    params(("code" = u32, Path, description = "AMFI scheme code"), SipCalcParams),
    responses((status = 200, description = "SIP outcome"), (status = 400, description = "Invalid input")))]
pub async fn calculate_sip(
    State(state): State<AppState>,
    ApiPath(code): ApiPath<u32>,
    ApiQuery(p): ApiQuery<SipCalcParams>,
) -> ApiResult<Json<Value>> {
    if !(1.0..=1e8).contains(&p.amount) {
        return Err(ApiError::bad("amount must be between 1 and 100000000"));
    }
    let day = p.day.unwrap_or(1);
    if !(1..=28).contains(&day) {
        return Err(ApiError::bad("day must be between 1 and 28"));
    }
    let start = parse_month(&p.start, "start")?;
    let end = p.end.as_deref().map(|e| parse_month(e, "end")).transpose()?;
    if let Some(end) = end {
        if end < start {
            return Err(ApiError::bad("end must not be before start"));
        }
        if (end - start).num_days() > 50 * 366 {
            return Err(ApiError::bad("at most 50 years of installments"));
        }
    }
    if !exists(&state, code).await? {
        return Err(ApiError::NotFound(format!("scheme {code} not found")));
    }
    let mut row = state
        .db
        .sql(SIP_CALC_SQL)
        .param("code", code)
        .param("amount", p.amount)
        .param("day", day)
        .param("start", start.to_string())
        .param("end", end.map(|e| e.to_string()).unwrap_or_default())
        .param("schedule", u8::from(p.schedule))
        .one()
        .await?
        .unwrap_or_default();
    for helper in ["flows", "irr"] {
        row.remove(helper);
    }
    if !p.schedule {
        row.remove("schedule");
    }
    if row.get("installments").and_then(Value::as_u64) == Some(0) {
        return Err(ApiError::bad("no NAVs in the requested period"));
    }
    row.insert("amount".into(), p.amount.into());
    row.insert("day".into(), day.into());
    Ok(one(&state, row))
}

fn parse_month(s: &str, name: &str) -> ApiResult<NaiveDate> {
    let bad = || ApiError::bad(format!("{name} must be a month YYYY-MM between 1990 and 2100"));
    if s.len() != 7 {
        return Err(bad());
    }
    let d = NaiveDate::parse_from_str(&format!("{s}-01"), "%Y-%m-%d").map_err(|_| bad())?;
    if !(1990..=2100).contains(&chrono::Datelike::year(&d)) {
        return Err(bad());
    }
    Ok(d)
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct LumpsumParams {
    /// Amount invested (₹).
    amount: f64,
    /// Investment date, YYYY-MM-DD; the first NAV on or after it is used.
    date: NaiveDate,
}

const LUMPSUM_SQL: &str = "
WITH {amount:Float64} AS amt
SELECT
    b.date AS buy_date, b.nav AS buy_nav, amt AS amount, amt / b.nav AS units,
    s.date AS value_date, s.nav AS value_nav, units * s.nav AS current_value,
    current_value - amt AS gain, current_value / amt - 1 AS abs_return,
    dateDiff('day', b.date, s.date) / 365.25 AS years,
    if(years >= 1, pow(current_value / amt, 1 / years) - 1, NULL) AS cagr
FROM
    (SELECT date, nav FROM nav_clean WHERE scheme_code = {code:UInt32} AND date >= {date:Date} ORDER BY date LIMIT 1) AS b,
    (SELECT date, nav FROM nav_clean WHERE scheme_code = {code:UInt32} ORDER BY date DESC LIMIT 1) AS s";

/// Value today of a one-time investment.
#[utoipa::path(get, path = "/v1/schemes/{code}/lumpsum/calculate", operation_id = "calculate_lumpsum",
    tag = "calculators", params(("code" = u32, Path, description = "AMFI scheme code"), LumpsumParams),
    responses((status = 200, description = "Lumpsum outcome"), (status = 400, description = "Invalid input")))]
pub async fn calculate_lumpsum(
    State(state): State<AppState>,
    ApiPath(code): ApiPath<u32>,
    ApiQuery(p): ApiQuery<LumpsumParams>,
) -> ApiResult<Json<Value>> {
    if !(1.0..=1e10).contains(&p.amount) {
        return Err(ApiError::bad("amount must be between 1 and 10000000000"));
    }
    let row = state
        .db
        .sql(LUMPSUM_SQL)
        .param("code", code)
        .param("amount", p.amount)
        .param("date", p.date.to_string())
        .one()
        .await?;
    match row {
        Some(row) => Ok(one(&state, row)),
        None if exists(&state, code).await? => Err(ApiError::bad("no NAV on or after that date")),
        None => Err(ApiError::NotFound(format!("scheme {code} not found"))),
    }
}

// ---------------------------------------------------------------------------------------------

async fn simple(state: &AppState, code: u32, sql: &str, params: &[(&str, String)]) -> ApiResult<Json<Value>> {
    let mut q = state.db.sql(sql).param("code", code);
    for (name, value) in params {
        q = q.param(name, value);
    }
    let rows = scheme_rows(state, code, q.rows().await?).await?;
    Ok(many(state, rows, Map::new()))
}

fn one_of(value: &str, allowed: &[&str], name: &str) -> ApiResult<()> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        let shown: Vec<_> = allowed.iter().filter(|a| !a.is_empty()).collect();
        Err(ApiError::bad(format!("{name} must be one of {shown:?}")))
    }
}

pub fn doc_queries() -> Vec<DocQuery> {
    let code = 125497u32;
    let series = |id, sql: String| {
        DocQuery::new(id, sql, true)
            .param("code", code)
            .param("from", MIN_DATE)
            .param("to", MAX_DATE)
            .param("interval", "month")
    };
    vec![
        DocQuery::new(
            "search_schemes",
            format!("SELECT {LIST_COLUMNS} FROM fund_metrics LIMIT {{limit:UInt32}}"),
            true,
        )
        .param("limit", 1),
        DocQuery::new("get_scheme", SCHEME_SQL, false).param("code", code),
        series("get_nav", nav_sql()),
        DocQuery::new("get_returns", RETURNS_SQL, true).param("code", code),
        DocQuery::new("get_calendar_returns", CALENDAR_SQL, true).param("code", code).param("period", ""),
        DocQuery::new("get_risk", RISK_SQL, true).param("code", code).param("basis", ""),
        DocQuery::new("get_relative", RELATIVE_SQL, true)
            .param("code", code)
            .param("basis", "")
            .param("benchmark", ""),
        DocQuery::new("get_rolling", ROLLING_SQL, true).param("code", code),
        series("get_rolling_series", rolling_series_sql(1116)).param("years", 3).param("cat_key", ""),
        DocQuery::new("get_sip", SIP_SQL, true).param("code", code),
        DocQuery::new("get_drawdowns", DRAWDOWNS_SQL, true).param("code", code),
        series("get_drawdown_series", drawdown_series_sql()),
        // with ?metric= the rows are a history and omit metric/category/plan
        DocQuery::new("get_ranks", RANKS_LATEST_SQL, true)
            .param("code", code)
            .optional(&["metric", "category", "plan"]),
        DocQuery::new("get_payouts", PAYOUTS_SQL, true).param("code", code),
        DocQuery::new("get_quality", QUALITY_SQL, false).param("code", code),
        DocQuery::new(
            "calculate_sip",
            format!(
                "SELECT * EXCEPT (flows, irr), 0. AS amount, toUInt8(1) AS day FROM ({SIP_CALC_SQL})"
            ),
            false,
        )
        .param("code", code)
        .param("amount", 1000.0)
        .param("day", 1)
        .param("start", "2020-01-01")
        .param("end", "2020-12-01")
        .param("schedule", 1)
        .optional(&["schedule"]),
        DocQuery::new("calculate_lumpsum", LUMPSUM_SQL, false)
            .param("code", code)
            .param("amount", 1000.0)
            .param("date", "2020-01-01"),
    ]
}
