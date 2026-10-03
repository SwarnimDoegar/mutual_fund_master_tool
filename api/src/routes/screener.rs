//! `/v1/screener`: filter and sort schemes on any headline metric in `fund_metrics`.
//!
//! Column names come only from the table's own column list (loaded at startup), never from raw
//! input; values are typed parameters.

use std::collections::HashMap;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Map, Value};
use utoipa::IntoParams;

use super::{ApiQuery, DocQuery, Paging, many, take_total};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/screener", get(screen))
}

const DEFAULT_FIELDS: &[&str] = &[
    "scheme_code", "scheme_name", "fund_house", "category", "plan", "option", "last_nav_date", "last_nav",
    "ret_1y", "cagr_3y", "cagr_5y", "volatility_3y_monthly", "sharpe_3y_monthly", "max_drawdown_3y",
    "alpha_3y_category", "rolling_3y_median", "sip_xirr_5y",
];

const STRING_FILTERS: &[&str] = &["category", "asset_class", "fund_house", "plan", "option", "scheme_type"];

/// Query parameters (documentation only; parsing accepts dynamic `min_*` / `max_*` keys).
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[allow(dead_code)]
pub struct ScreenerParams {
    category: Option<String>,
    asset_class: Option<String>,
    fund_house: Option<String>,
    /// `Direct` or `Regular`.
    plan: Option<String>,
    /// `Growth`, `IDCW` or `Bonus`.
    option: Option<String>,
    scheme_type: Option<String>,
    /// Only schemes with a recent NAV (default true).
    active: Option<bool>,
    /// Only funds in a ranked peer group: active open-ended Growth options (default false).
    peer_only: Option<bool>,
    /// Sort column from `fund_metrics`; prefix `-` for descending. Default `-cagr_3y`.
    sort: Option<String>,
    /// Comma-separated `fund_metrics` columns to return (default: a headline set).
    fields: Option<String>,
    /// Page size (1-500, default 50).
    limit: Option<u32>,
    offset: Option<u32>,
}

fn is_numeric(ch_type: &str) -> bool {
    let t = ch_type.trim_start_matches("Nullable(").trim_end_matches(')');
    t.starts_with("Float") || t.starts_with("UInt") || t.starts_with("Int")
}

fn parse_bool(v: &str, name: &str) -> ApiResult<bool> {
    match v {
        "true" | "1" => Ok(true),
        "false" | "0" => Ok(false),
        _ => Err(ApiError::bad(format!("{name} must be true or false"))),
    }
}

/// Screen schemes by category, plan and metric ranges, sorted by any metric.
///
/// Range filters: any numeric `fund_metrics` column as `min_<column>` / `max_<column>`, e.g.
/// `min_cagr_3y=0.12&max_volatility_3y_monthly=0.18`. Returns are fractions (0.12 = 12%).
/// Schemes without a value for a filtered column are excluded. Unknown parameters are rejected.
#[utoipa::path(get, path = "/v1/screener", operation_id = "screen", tag = "screener",
    params(ScreenerParams),
    responses((status = 200, description = "Matching schemes"), (status = 400, description = "Unknown column or bad value")))]
pub async fn screen(
    State(state): State<AppState>,
    ApiQuery(params): ApiQuery<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let columns = &state.metric_columns;
    let mut conds: Vec<String> = vec![];
    let mut string_params: Vec<(String, String)> = vec![];
    let mut float_params: Vec<(String, f64)> = vec![];
    let mut active = true;
    let mut peer_only = false;
    let mut sort = "-cagr_3y".to_string();
    let mut fields: Vec<String> = DEFAULT_FIELDS.iter().map(|s| s.to_string()).collect();
    let mut paging = Paging { limit: None, offset: None };

    // deterministic order so equal queries produce equal SQL
    let mut keys: Vec<&String> = params.keys().collect();
    keys.sort();
    for key in keys {
        let value = &params[key];
        match key.as_str() {
            k if STRING_FILTERS.contains(&k) => {
                conds.push(format!("{k} = {{{k}:String}}"));
                string_params.push((k.to_string(), value.clone()));
            }
            "active" => active = parse_bool(value, "active")?,
            "peer_only" => peer_only = parse_bool(value, "peer_only")?,
            "sort" => sort = value.clone(),
            "fields" => {
                fields = value.split(',').map(|f| f.trim().to_string()).filter(|f| !f.is_empty()).collect();
                if fields.is_empty() || fields.len() > 130 {
                    return Err(ApiError::bad("fields must list 1-130 columns"));
                }
                if let Some(bad) = fields.iter().find(|f| !columns.contains_key(f.as_str())) {
                    return Err(ApiError::bad(format!("unknown field {bad:?}")));
                }
                if !fields.iter().any(|f| f == "scheme_code") {
                    fields.insert(0, "scheme_code".into());
                }
            }
            "limit" => paging.limit = Some(value.parse().map_err(|_| ApiError::bad("limit must be a number"))?),
            "offset" => paging.offset = Some(value.parse().map_err(|_| ApiError::bad("offset must be a number"))?),
            k => {
                let (op, column) = if let Some(c) = k.strip_prefix("min_") {
                    (">=", c)
                } else if let Some(c) = k.strip_prefix("max_") {
                    ("<=", c)
                } else {
                    return Err(ApiError::bad(format!("unknown parameter {k:?}")));
                };
                let ch_type = columns
                    .get(column)
                    .ok_or_else(|| ApiError::bad(format!("unknown column {column:?} in {k:?}")))?;
                if !is_numeric(ch_type) {
                    return Err(ApiError::bad(format!("{column} is not numeric")));
                }
                let v: f64 = value.parse().ok().filter(|v: &f64| v.is_finite())
                    .ok_or_else(|| ApiError::bad(format!("{k} must be a number")))?;
                let name = format!("f{}", float_params.len());
                conds.push(format!("{column} {op} {{{name}:Float64}}"));
                float_params.push((name, v));
            }
        }
    }
    if active {
        conds.push("is_active = 1".into());
    }
    if peer_only {
        conds.push("peer_eligible = 1".into());
    }
    let (sort_col, desc) = match sort.strip_prefix('-') {
        Some(c) => (c, true),
        None => (sort.as_str(), false),
    };
    if !columns.contains_key(sort_col) {
        return Err(ApiError::bad(format!("unknown sort column {sort_col:?}")));
    }
    let (limit, offset) = paging.resolve(50)?;

    let where_sql = if conds.is_empty() { "1".to_string() } else { conds.join(" AND ") };
    let sql = format!(
        "SELECT {}, count() OVER () AS total FROM fund_metrics WHERE {where_sql}
         ORDER BY {sort_col} {} NULLS LAST, scheme_code
         LIMIT {{limit:UInt32}} OFFSET {{offset:UInt32}}",
        fields.join(", "),
        if desc { "DESC" } else { "ASC" },
    );
    let bind = |mut q: crate::db::Query| {
        for (name, v) in &string_params {
            q = q.param(name, v);
        }
        for (name, v) in &float_params {
            q = q.param(name, v);
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
    extra.insert("sort".into(), sort.into());
    Ok(many(&state, rows, extra))
}

pub fn doc_queries() -> Vec<DocQuery> {
    // the default field set; `fields` can select any other fund_metrics column (see FundMetrics)
    vec![
        DocQuery::new("screen", format!("SELECT {} FROM fund_metrics", DEFAULT_FIELDS.join(", ")), true)
            .required_only(&["scheme_code"]),
    ]
}
