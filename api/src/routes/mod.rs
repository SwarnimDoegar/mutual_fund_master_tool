pub mod catalog;
pub mod schemes;
pub mod screener;

use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{FromRequestParts, State};
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router, middleware};
use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::cache::http_cache;
use crate::db::Row;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// `Path` that reports bad input as problem+json.
#[derive(FromRequestParts)]
#[from_request(via(axum::extract::Path), rejection(ApiError))]
pub struct ApiPath<T>(pub T);

/// `Query` that reports bad input as problem+json.
#[derive(FromRequestParts)]
#[from_request(via(axum::extract::Query), rejection(ApiError))]
pub struct ApiQuery<T>(pub T);

impl From<PathRejection> for ApiError {
    fn from(r: PathRejection) -> Self {
        ApiError::BadRequest(r.body_text())
    }
}

impl From<QueryRejection> for ApiError {
    fn from(r: QueryRejection) -> Self {
        ApiError::BadRequest(r.body_text())
    }
}

/// `{"data": {...}, "meta": {...}}`
pub fn one(state: &AppState, row: Row) -> Json<Value> {
    Json(json!({ "data": row, "meta": meta(state, Map::new()) }))
}

/// `{"data": [...], "meta": {...}}`
pub fn many(state: &AppState, rows: Vec<Row>, extra: Map<String, Value>) -> Json<Value> {
    let mut extra = extra;
    extra.insert("count".into(), rows.len().into());
    Json(json!({ "data": rows, "meta": meta(state, extra) }))
}

fn meta(state: &AppState, mut extra: Map<String, Value>) -> Map<String, Value> {
    let v = state.version();
    extra.insert("as_of_date".into(), v.as_of_date.into());
    extra.insert("data_updated_at".into(), v.updated_at.into());
    extra
}

/// Pulls `total` (from `count() OVER ()`) out of list rows into the meta block.
pub fn take_total(rows: &mut [Row]) -> u64 {
    let total = rows.first().and_then(|r| r.get("total")).and_then(Value::as_u64).unwrap_or(0);
    for r in rows.iter_mut() {
        r.remove("total");
    }
    total
}

/// Interval for down-sampling time series: the last value of each day/week/month.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Interval {
    #[default]
    Day,
    Week,
    Month,
}

impl Interval {
    pub fn as_str(self) -> &'static str {
        match self {
            Interval::Day => "day",
            Interval::Week => "week",
            Interval::Month => "month",
        }
    }
}

/// SQL expression bucketing `col` by the `{interval:String}` parameter.
pub const BUCKET: &str =
    "multiIf({interval:String} = 'week', toMonday(date), {interval:String} = 'month', toStartOfMonth(date), date)";

/// Pagination values (fields are declared on each params struct: serde's flatten breaks numeric
/// parsing of query strings).
pub struct Paging {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

impl Paging {
    pub fn resolve(&self, default: u32) -> ApiResult<(u32, u32)> {
        let limit = self.limit.unwrap_or(default);
        if !(1..=500).contains(&limit) {
            return Err(ApiError::bad("limit must be between 1 and 500"));
        }
        Ok((limit, self.offset.unwrap_or(0)))
    }
}

/// A query whose output shape documents an operation's response (see docs.rs).
pub struct DocQuery {
    pub operation_id: &'static str,
    pub sql: String,
    pub params: Vec<(&'static str, Value)>,
    pub many: bool,
    /// Fields that may be absent from some responses of this operation.
    pub optional: Vec<&'static str>,
    /// If set, only these fields are always present (e.g. when `fields=` picks columns).
    pub required_only: Option<Vec<&'static str>>,
}

impl DocQuery {
    pub fn new(operation_id: &'static str, sql: impl Into<String>, many: bool) -> Self {
        Self { operation_id, sql: sql.into(), params: vec![], many, optional: vec![], required_only: None }
    }

    pub fn optional(mut self, fields: &[&'static str]) -> Self {
        self.optional.extend_from_slice(fields);
        self
    }

    pub fn required_only(mut self, fields: &[&'static str]) -> Self {
        self.required_only = Some(fields.to_vec());
        self
    }

    pub fn param(mut self, name: &'static str, value: impl Serialize) -> Self {
        self.params.push((name, serde_json::to_value(value).expect("serializable doc param")));
        self
    }
}

pub fn doc_queries() -> Vec<DocQuery> {
    let mut out = vec![DocQuery::new("get_meta", META_SQL, false)];
    out.extend(schemes::doc_queries());
    out.extend(screener::doc_queries());
    out.extend(catalog::doc_queries());
    out
}

pub fn router(state: AppState) -> Router {
    let v1 = Router::new()
        .route("/meta", get(get_meta))
        .merge(schemes::routes())
        .merge(screener::routes())
        .merge(catalog::routes())
        .layer(middleware::from_fn_with_state(state.clone(), http_cache));
    Router::new()
        .nest("/v1", v1)
        .route("/health", get(health))
        .route("/ready", get(ready))
        .with_state(state)
}

const META_SQL: &str = "
SELECT
    any(as_of_date) AS as_of_date,
    toUInt64(count()) AS schemes,
    toUInt64(countIf(is_active)) AS active_schemes,
    toUInt64(countIf(peer_eligible)) AS ranked_funds,
    toUInt64(uniqExactIf(category, category != 'Unclassified')) AS categories,
    toUInt64(uniqExact(fund_house)) AS fund_houses
FROM scheme_info";

/// Dataset summary and freshness.
#[utoipa::path(get, path = "/v1/meta", operation_id = "get_meta", tag = "meta",
    responses((status = 200, description = "Dataset summary")))]
pub async fn get_meta(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let row = state.db.sql(META_SQL).one().await?.unwrap_or_default();
    Ok(one(&state, row))
}

/// Liveness: the process is up.
#[utoipa::path(get, path = "/health", tag = "meta", responses((status = 200, description = "Alive")))]
pub async fn health() -> impl IntoResponse {
    ([(header::CACHE_CONTROL, "no-store")], "ok")
}

/// Readiness: ClickHouse answers and holds computed metrics.
#[utoipa::path(get, path = "/ready", tag = "meta",
    responses((status = 200, description = "Ready"), (status = 503, description = "Not ready")))]
pub async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    let ok = state.db.ping().await.is_ok() && !state.version().as_of_date.is_empty();
    let status = if ok { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE };
    (status, [(header::CACHE_CONTROL, "no-store")], if ok { "ready" } else { "not ready" })
}
