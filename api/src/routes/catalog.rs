//! Categories, fund houses, benchmarks and multi-scheme comparison.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Map, Value};
use utoipa::IntoParams;

use super::{ApiPath, ApiQuery, BUCKET, DocQuery, Interval, many, one};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/categories", get(list_categories))
        .route("/categories/{category}/stats", get(get_category_stats))
        .route("/categories/{category}/index", get(get_category_index))
        .route("/fund-houses", get(list_fund_houses))
        .route("/fund-houses/{name}", get(get_fund_house))
        .route("/benchmarks", get(list_benchmarks))
        .route("/compare", get(compare))
        .route("/compare/growth", get(compare_growth))
}

const CATEGORIES_SQL: &str = "
SELECT
    i.asset_class AS asset_class,
    i.category AS category,
    toUInt8(any(i.rankable_category)) AS rankable,
    toUInt64(countIf(i.is_active)) AS active_schemes,
    toUInt64(countIf(i.peer_eligible AND i.plan = 'Direct')) AS ranked_direct,
    toUInt64(countIf(i.peer_eligible AND i.plan = 'Regular')) AS ranked_regular,
    any(bp.index_name) AS benchmark_index
FROM scheme_info AS i
LEFT JOIN benchmark_proxy AS bp ON bp.category = i.category
WHERE i.category != 'Unclassified'
GROUP BY i.asset_class, i.category
ORDER BY asset_class, category
SETTINGS join_use_nulls = 1";

/// Canonical SEBI categories with scheme counts and the index used as benchmark.
#[utoipa::path(get, path = "/v1/categories", operation_id = "list_categories", tag = "categories",
    responses((status = 200, description = "Categories")))]
pub async fn list_categories(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let rows = state.db.sql(CATEGORIES_SQL).rows().await?;
    Ok(many(&state, rows, Map::new()))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct PlanParams {
    /// `Direct` or `Regular`; both when omitted.
    plan: Option<String>,
}

const CATEGORY_STATS_SQL: &str = "
SELECT s.as_of_date AS as_of_date, s.category AS category, s.plan AS plan, s.metric AS metric,
       s.n_funds AS n_funds, s.mean AS mean, s.median AS median, s.p25 AS p25, s.p75 AS p75,
       s.min_value AS min_value, s.max_value AS max_value, s.stddev AS stddev,
       s.best_scheme_code AS best_scheme_code, b.scheme_name AS best_scheme_name,
       s.worst_scheme_code AS worst_scheme_code, w.scheme_name AS worst_scheme_name
FROM category_stats AS s
LEFT JOIN scheme_info AS b ON b.scheme_code = s.best_scheme_code
LEFT JOIN scheme_info AS w ON w.scheme_code = s.worst_scheme_code
WHERE s.category = {category:String} AND ({plan:String} = '' OR s.plan = {plan:String})
ORDER BY s.plan, s.metric";

/// Distribution of each headline metric across a category's peer group (mean, median, quartiles,
/// best and worst fund).
#[utoipa::path(get, path = "/v1/categories/{category}/stats", operation_id = "get_category_stats",
    tag = "categories", params(("category" = String, Path, description = "Canonical category"), PlanParams),
    responses((status = 200, description = "Category statistics"), (status = 404, description = "Unknown category")))]
pub async fn get_category_stats(
    State(state): State<AppState>,
    ApiPath(category): ApiPath<String>,
    ApiQuery(p): ApiQuery<PlanParams>,
) -> ApiResult<Json<Value>> {
    let rows = state
        .db
        .sql(CATEGORY_STATS_SQL)
        .param("category", &category)
        .param("plan", p.plan.unwrap_or_default())
        .rows()
        .await?;
    if rows.is_empty() {
        return Err(ApiError::NotFound(format!("no ranked funds in category {category:?}")));
    }
    Ok(many(&state, rows, Map::new()))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct CategoryIndexParams {
    /// `Direct` (default) or `Regular`.
    plan: Option<String>,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    /// `day`, `week` or `month` (default `week`).
    interval: Option<Interval>,
}

fn category_index_sql() -> String {
    format!(
        "SELECT max(date) AS date, argMax(level, date) AS level, argMax(n_funds, date) AS n_funds
         FROM category_index
         WHERE category = {{category:String}} AND plan = {{plan:String}} AND date BETWEEN {{from:Date}} AND {{to:Date}}
         GROUP BY {BUCKET} AS bucket ORDER BY bucket
         SETTINGS prefer_column_name_to_alias = 1"
    )
}

/// Equal-weighted category index level (base 100) and the number of funds behind each point.
#[utoipa::path(get, path = "/v1/categories/{category}/index", operation_id = "get_category_index",
    tag = "categories", params(("category" = String, Path, description = "Canonical category"), CategoryIndexParams),
    responses((status = 200, description = "Index series"), (status = 404, description = "Unknown category")))]
pub async fn get_category_index(
    State(state): State<AppState>,
    ApiPath(category): ApiPath<String>,
    ApiQuery(p): ApiQuery<CategoryIndexParams>,
) -> ApiResult<Json<Value>> {
    let rows = state
        .db
        .sql(&category_index_sql())
        .param("category", &category)
        .param("plan", p.plan.unwrap_or_else(|| "Direct".into()))
        .param("from", p.from.map(|d| d.to_string()).unwrap_or("1970-01-01".into()))
        .param("to", p.to.map(|d| d.to_string()).unwrap_or("2149-06-06".into()))
        .param("interval", p.interval.unwrap_or(Interval::Week).as_str())
        .rows()
        .await?;
    if rows.is_empty() {
        return Err(ApiError::NotFound(format!("no index for category {category:?}")));
    }
    Ok(many(&state, rows, Map::new()))
}

const FUND_HOUSES_SQL: &str = "SELECT * FROM fund_house_stats ORDER BY active_schemes DESC, fund_house";
const FUND_HOUSE_SQL: &str = "SELECT * FROM fund_house_stats WHERE fund_house = {name:String}";

/// Fund houses (AMCs) with scheme counts and how their ranked funds sit within their categories.
#[utoipa::path(get, path = "/v1/fund-houses", operation_id = "list_fund_houses", tag = "fund houses",
    responses((status = 200, description = "Fund houses")))]
pub async fn list_fund_houses(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let rows = state.db.sql(FUND_HOUSES_SQL).rows().await?;
    Ok(many(&state, rows, Map::new()))
}

/// One fund house's scorecard. List its schemes with `/v1/schemes?fund_house=...`.
#[utoipa::path(get, path = "/v1/fund-houses/{name}", operation_id = "get_fund_house", tag = "fund houses",
    params(("name" = String, Path, description = "Fund house name as listed")),
    responses((status = 200, description = "Fund house"), (status = 404, description = "Unknown fund house")))]
pub async fn get_fund_house(State(state): State<AppState>, ApiPath(name): ApiPath<String>) -> ApiResult<Json<Value>> {
    let row = state.db.sql(FUND_HOUSE_SQL).param("name", &name).one().await?;
    let row = row.ok_or_else(|| ApiError::NotFound(format!("fund house {name:?} not found")))?;
    Ok(one(&state, row))
}

const BENCHMARKS_SQL: &str = "
SELECT bp.category AS category, bp.index_name AS index_name, bp.scheme_code AS proxy_scheme_code,
       i.scheme_name AS proxy_scheme_name, i.inception_date AS proxy_since
FROM benchmark_proxy AS bp
LEFT JOIN scheme_info AS i ON i.scheme_code = bp.scheme_code
ORDER BY category
SETTINGS join_use_nulls = 1";

/// Index-fund proxies used for each category's AMFI tier-1 benchmark.
#[utoipa::path(get, path = "/v1/benchmarks", operation_id = "list_benchmarks", tag = "categories",
    responses((status = 200, description = "Benchmarks")))]
pub async fn list_benchmarks(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let rows = state.db.sql(BENCHMARKS_SQL).rows().await?;
    Ok(many(&state, rows, Map::new()))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct CompareParams {
    /// 2-10 comma-separated scheme codes.
    codes: String,
    /// For /compare/growth: start date (default: the latest first-NAV date among the schemes).
    from: Option<NaiveDate>,
    /// For /compare/growth: `day`, `week` (default) or `month`.
    interval: Option<Interval>,
}

fn parse_codes(raw: &str) -> ApiResult<Vec<u32>> {
    let codes: Vec<u32> = raw
        .split(',')
        .map(|c| c.trim().parse::<u32>().map_err(|_| ApiError::bad(format!("bad scheme code {c:?}"))))
        .collect::<ApiResult<_>>()?;
    if !(1..=10).contains(&codes.len()) {
        return Err(ApiError::bad("codes must list 1-10 schemes"));
    }
    Ok(codes)
}

const COMPARE_SQL: &str = "
SELECT * FROM fund_metrics WHERE scheme_code IN {codes:Array(UInt32)}
ORDER BY indexOf({codes:Array(UInt32)}, scheme_code)";

/// Headline metrics for several schemes side by side (in the order requested).
#[utoipa::path(get, path = "/v1/compare", operation_id = "compare", tag = "compare",
    params(CompareParams), responses((status = 200, description = "Schemes")))]
pub async fn compare(State(state): State<AppState>, ApiQuery(p): ApiQuery<CompareParams>) -> ApiResult<Json<Value>> {
    let codes = parse_codes(&p.codes)?;
    let rows = state.db.sql(COMPARE_SQL).param("codes", &codes).rows().await?;
    let mut extra = Map::new();
    let found: Vec<u64> = rows.iter().filter_map(|r| r.get("scheme_code").and_then(Value::as_u64)).collect();
    let missing: Vec<u32> = codes.iter().copied().filter(|c| !found.contains(&u64::from(*c))).collect();
    extra.insert("missing".into(), missing.into());
    Ok(many(&state, rows, extra))
}

fn growth_sql() -> String {
    format!(
        "WITH
            -- '' = start when the youngest scheme starts
            if({{from:String}} = '',
               (SELECT max(d) FROM (SELECT min(date) AS d FROM nav_clean
                                    WHERE scheme_code IN {{codes:Array(UInt32)}} GROUP BY scheme_code)),
               toDate({{from:String}})) AS start,
            base AS
            (
                SELECT scheme_code, argMax(nav, date) AS base_nav
                FROM nav_clean WHERE scheme_code IN {{codes:Array(UInt32)}} AND date <= start
                GROUP BY scheme_code
            )
        SELECT s.scheme_code AS scheme_code, any(i.scheme_name) AS scheme_name,
               arraySort(x -> x.date, groupArray(CAST((s.date, s.value), 'Tuple(date Date, value Float64)'))) AS series
        FROM
        (
            SELECT n.scheme_code AS scheme_code, max(n.date) AS date, argMax(n.nav, n.date) / any(b.base_nav) * 100 AS value
            FROM nav_clean AS n INNER JOIN base AS b ON b.scheme_code = n.scheme_code
            WHERE n.scheme_code IN {{codes:Array(UInt32)}} AND n.date >= start
            GROUP BY n.scheme_code, {} AS bucket
        ) AS s
        INNER JOIN scheme_info AS i ON i.scheme_code = s.scheme_code
        GROUP BY s.scheme_code
        ORDER BY indexOf({{codes:Array(UInt32)}}, s.scheme_code)
        SETTINGS prefer_column_name_to_alias = 1",
        BUCKET.replace("date", "n.date")
    )
}

/// Growth of 100 for several schemes from a common start date (a scheme's NAV on or before the
/// start is the base), for comparison charts.
#[utoipa::path(get, path = "/v1/compare/growth", operation_id = "compare_growth", tag = "compare",
    params(CompareParams), responses((status = 200, description = "Rebased series per scheme")))]
pub async fn compare_growth(
    State(state): State<AppState>,
    ApiQuery(p): ApiQuery<CompareParams>,
) -> ApiResult<Json<Value>> {
    let codes = parse_codes(&p.codes)?;
    let rows = state
        .db
        .sql(&growth_sql())
        .param("codes", &codes)
        .param("from", p.from.map(|d| d.to_string()).unwrap_or_default())
        .param("interval", p.interval.unwrap_or(Interval::Week).as_str())
        .rows()
        .await?;
    Ok(many(&state, rows, Map::new()))
}

pub fn doc_queries() -> Vec<DocQuery> {
    vec![
        DocQuery::new("list_categories", CATEGORIES_SQL, true),
        DocQuery::new("get_category_stats", CATEGORY_STATS_SQL, true)
            .param("category", "")
            .param("plan", ""),
        DocQuery::new("get_category_index", category_index_sql(), true)
            .param("category", "")
            .param("plan", "Direct")
            .param("from", "1970-01-01")
            .param("to", "2149-06-06")
            .param("interval", "week"),
        DocQuery::new("list_fund_houses", FUND_HOUSES_SQL, true),
        DocQuery::new("get_fund_house", FUND_HOUSE_SQL, false).param("name", ""),
        DocQuery::new("list_benchmarks", BENCHMARKS_SQL, true),
        DocQuery::new("compare", COMPARE_SQL, true).param("codes", vec![1u32]),
        DocQuery::new("compare_growth", growth_sql(), true)
            .param("codes", vec![1u32])
            .param("from", "")
            .param("interval", "week"),
    ]
}
