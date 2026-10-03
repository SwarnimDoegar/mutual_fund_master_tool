//! OpenAPI document. Paths and parameters come from `#[utoipa::path]`; response schemas are
//! derived at startup by running `DESCRIBE` on each endpoint's actual query, so the documented
//! shape cannot drift from the SQL. This also validates every query against the live schema
//! before the server takes traffic.

use serde::Deserialize;
use serde_json::{Map, Value, json};
use utoipa::OpenApi;

use crate::db::Db;
use crate::routes::{self, DocQuery};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Mutual Fund Analytics API",
        version = "1.0.0",
        description = "Read-only analytics for every Indian mutual fund scheme, computed daily from \
AMFI NAVs (via mfapi.in): trailing, rolling and calendar returns, SIP XIRR, risk and drawdowns, \
benchmark-relative statistics and peer ranks.\n\nConventions: returns and ratios are fractions \
(0.12 = 12%); dates are YYYY-MM-DD; every response is `{\"data\": ..., \"meta\": {\"as_of_date\", \
\"data_updated_at\", ...}}`; errors are RFC 9457 problem details. Responses carry ETags and are \
cached until the next daily data update."
    ),
    paths(
        routes::get_meta, routes::health, routes::ready,
        routes::schemes::search_schemes, routes::schemes::get_scheme, routes::schemes::get_nav,
        routes::schemes::get_returns, routes::schemes::get_calendar_returns, routes::schemes::get_risk,
        routes::schemes::get_relative, routes::schemes::get_rolling, routes::schemes::get_rolling_series,
        routes::schemes::get_sip, routes::schemes::calculate_sip, routes::schemes::calculate_lumpsum,
        routes::schemes::get_drawdowns, routes::schemes::get_drawdown_series, routes::schemes::get_ranks,
        routes::schemes::get_payouts, routes::schemes::get_quality,
        routes::screener::screen,
        routes::catalog::list_categories, routes::catalog::get_category_stats,
        routes::catalog::get_category_index, routes::catalog::list_fund_houses,
        routes::catalog::get_fund_house, routes::catalog::list_benchmarks,
        routes::catalog::compare, routes::catalog::compare_growth,
    ),
    // referenced by `interval` parameters; utoipa does not register parameter schemas itself
    components(schemas(routes::Interval)),
    tags(
        (name = "schemes", description = "Search, scheme detail and per-scheme metrics"),
        (name = "calculators", description = "SIP and lumpsum what-ifs"),
        (name = "screener", description = "Filter and rank schemes"),
        (name = "categories", description = "SEBI categories, category statistics and benchmarks"),
        (name = "fund houses", description = "AMC scorecards"),
        (name = "compare", description = "Side-by-side comparison"),
        (name = "meta", description = "Dataset freshness and service health"),
    )
)]
struct ApiDoc;

#[derive(Deserialize)]
struct Described {
    name: String,
    r#type: String,
}

/// Build the final document. Fails if any endpoint's SQL does not compile against the database.
pub async fn build(db: &Db, public_url: &str) -> anyhow::Result<Value> {
    let mut doc = serde_json::to_value(ApiDoc::openapi())?;
    doc["servers"] = json!([{ "url": public_url }]);

    let mut schemas = Map::new();
    schemas.insert("Meta".into(), json!({
        "type": "object",
        "properties": {
            "as_of_date": { "type": "string", "format": "date", "description": "Latest NAV date in the dataset" },
            "data_updated_at": { "type": "string", "description": "When the daily pipeline last completed" },
            "count": { "type": "integer" },
            "total": { "type": "integer", "description": "Rows matching before pagination (list endpoints)" }
        }
    }));
    schemas.insert("Problem".into(), json!({
        "type": "object",
        "description": "RFC 9457 problem details",
        "properties": {
            "type": { "type": "string" }, "title": { "type": "string" },
            "status": { "type": "integer" }, "detail": { "type": "string" }
        }
    }));

    for q in routes::doc_queries() {
        let mut row_schema = describe(db, &q).await?;
        // presence is not the same as SQL nullability for variant responses
        if let Some(req) = row_schema.get_mut("required").and_then(Value::as_array_mut) {
            match &q.required_only {
                Some(only) => req.retain(|r| only.iter().any(|o| r == o)),
                None => req.retain(|r| !q.optional.iter().any(|o| r == o)),
            }
        }
        let name = schema_name(q.operation_id);
        schemas.insert(name.clone(), row_schema);
        let data = if q.many {
            json!({ "type": "array", "items": { "$ref": format!("#/components/schemas/{name}") } })
        } else {
            json!({ "$ref": format!("#/components/schemas/{name}") })
        };
        let envelope = json!({
            "type": "object",
            "required": ["data", "meta"],
            "properties": { "data": data, "meta": { "$ref": "#/components/schemas/Meta" } }
        });
        attach(&mut doc, q.operation_id, envelope)?;
    }
    // Every 4xx/5xx is a problem document.
    if let Some(paths) = doc["paths"].as_object_mut() {
        for item in paths.values_mut() {
            for op in item.as_object_mut().into_iter().flat_map(|o| o.values_mut()) {
                if let Some(responses) = op.get_mut("responses").and_then(Value::as_object_mut) {
                    for (status, resp) in responses.iter_mut() {
                        if status.starts_with('4') || status.starts_with('5') {
                            resp["content"] = json!({ "application/problem+json": {
                                "schema": { "$ref": "#/components/schemas/Problem" } } });
                        }
                    }
                }
            }
        }
    }
    // merge with utoipa's own components (e.g. the Interval enum used by parameters)
    let existing = doc["components"]["schemas"].as_object().cloned().unwrap_or_default();
    let mut merged = existing;
    merged.extend(schemas);
    doc["components"]["schemas"] = Value::Object(merged);
    Ok(doc)
}

async fn describe(db: &Db, q: &DocQuery) -> anyhow::Result<Value> {
    let mut query = db.sql(&format!("DESCRIBE TABLE ({})", q.sql));
    for (name, value) in &q.params {
        query = query.param(name, value);
    }
    let cols: Vec<Described> = query
        .typed()
        .await
        .map_err(|e| {
            let cause = std::error::Error::source(&e).map(|s| format!("{s:#}")).unwrap_or_default();
            anyhow::anyhow!("query for {} does not compile: {e}: {cause}", q.operation_id)
        })?;
    let mut props = Map::new();
    let mut required = vec![];
    for c in cols {
        if c.name == "total" {
            continue;
        }
        let (schema, nullable) = ch_type_to_schema(&c.r#type);
        if !nullable {
            required.push(Value::String(c.name.clone()));
        }
        props.insert(c.name, schema);
    }
    Ok(json!({ "type": "object", "properties": props, "required": required }))
}

/// Map a ClickHouse type (as rendered in JSON output) to JSON Schema. Returns (schema, nullable).
fn ch_type_to_schema(t: &str) -> (Value, bool) {
    let t = t.trim();
    if let Some(inner) = strip_wrapper(t, "Nullable") {
        let (mut s, _) = ch_type_to_schema(inner);
        if let Some(ty) = s.get("type").cloned() {
            s["type"] = json!([ty, "null"]);
        }
        return (s, true);
    }
    if let Some(inner) = strip_wrapper(t, "LowCardinality") {
        return ch_type_to_schema(inner);
    }
    if let Some(inner) = strip_wrapper(t, "Array") {
        let (items, _) = ch_type_to_schema(inner);
        return (json!({ "type": "array", "items": items }), false);
    }
    if let Some(inner) = strip_wrapper(t, "Tuple") {
        let mut props = Map::new();
        for field in split_top_level(inner) {
            if let Some((name, ty)) = field.trim().split_once(' ') {
                props.insert(name.to_string(), ch_type_to_schema(ty).0);
            }
        }
        return (json!({ "type": "object", "properties": props }), false);
    }
    let s = match t {
        _ if t.starts_with("Float") => json!({ "type": "number" }),
        _ if t.starts_with("UInt") || t.starts_with("Int") => json!({ "type": "integer" }),
        "Bool" => json!({ "type": "boolean" }),
        "Date" | "Date32" => json!({ "type": "string", "format": "date" }),
        _ if t.starts_with("DateTime") => json!({ "type": "string", "format": "date-time" }),
        _ => json!({ "type": "string" }),
    };
    (s, false)
}

fn strip_wrapper<'a>(t: &'a str, name: &str) -> Option<&'a str> {
    t.strip_prefix(name)?.strip_prefix('(')?.strip_suffix(')')
}

fn split_top_level(s: &str) -> Vec<&str> {
    let (mut depth, mut start, mut out) = (0i32, 0usize, vec![]);
    for (i, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                out.push(&s[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(&s[start..]);
    out
}

fn schema_name(operation_id: &str) -> String {
    // get_scheme -> SchemeRow is clearer than GetSchemeRow
    let base = operation_id
        .trim_start_matches("get_")
        .trim_start_matches("list_")
        .trim_start_matches("search_");
    let mut out = String::new();
    for part in base.split('_') {
        let mut chars = part.chars();
        if let Some(first) = chars.next() {
            out.extend(first.to_uppercase());
            out.push_str(chars.as_str());
        }
    }
    out + "Row"
}

fn attach(doc: &mut Value, operation_id: &str, schema: Value) -> anyhow::Result<()> {
    let paths = doc["paths"].as_object_mut().ok_or_else(|| anyhow::anyhow!("no paths"))?;
    for item in paths.values_mut() {
        for op in item.as_object_mut().into_iter().flat_map(|o| o.values_mut()) {
            if op.get("operationId").and_then(Value::as_str) == Some(operation_id) {
                op["responses"]["200"]["content"] = json!({ "application/json": { "schema": schema } });
                return Ok(());
            }
        }
    }
    anyhow::bail!("operation {operation_id} not found in OpenAPI paths")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_clickhouse_types() {
        assert_eq!(ch_type_to_schema("Nullable(Float64)").0, json!({ "type": ["number", "null"] }));
        assert_eq!(ch_type_to_schema("LowCardinality(String)").0, json!({ "type": "string" }));
        assert_eq!(
            ch_type_to_schema("Array(Tuple(date Date, value Float64))").0,
            json!({ "type": "array", "items": { "type": "object", "properties": {
                "date": { "type": "string", "format": "date" }, "value": { "type": "number" } } } })
        );
        assert!(ch_type_to_schema("Nullable(Date)").1);
        assert_eq!(schema_name("get_rolling_series"), "RollingSeriesRow");
    }
}
