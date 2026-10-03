//! Read-only REST API over the mutual fund ClickHouse tables (see README).

pub mod cache;
pub mod config;
pub mod db;
pub mod docs;
pub mod error;
pub mod routes;
pub mod state;

use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::http::{HeaderName, HeaderValue, Method, StatusCode};
use axum::routing::get;
use serde_json::Value;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::state::AppState;

/// Build the state, validate every endpoint query against ClickHouse, and assemble the router.
pub async fn build(cfg: Config) -> anyhow::Result<(AppState, axum::Router)> {
    let state = AppState::new(cfg.clone()).await?;
    let openapi = docs::build(&state.db, &cfg.public_url).await?;
    let router = app(state.clone(), openapi, &cfg)?;
    Ok((state, router))
}

pub fn app(state: AppState, openapi: Value, cfg: &Config) -> anyhow::Result<axum::Router> {
    let openapi = Arc::new(openapi);
    let spec = openapi.clone();
    let docs_html = scalar_html();

    let request_id = HeaderName::from_static("x-request-id");
    Ok(routes::router(state)
        .route("/openapi.json", get(move || async move { Json((*spec).clone()) }))
        .route("/docs", get(move || async move { axum::response::Html(docs_html) }))
        .layer(cors(&cfg.cors_origins)?)
        .layer(CompressionLayer::new())
        .layer(TimeoutLayer::with_status_code(
            StatusCode::GATEWAY_TIMEOUT,
            Duration::from_secs(cfg.request_timeout),
        ))
        .layer(TraceLayer::new_for_http())
        .layer(PropagateRequestIdLayer::new(request_id.clone()))
        .layer(SetRequestIdLayer::new(request_id, MakeRequestUuid)))
}

fn cors(origins: &str) -> anyhow::Result<CorsLayer> {
    let allow = if origins.trim() == "*" {
        AllowOrigin::any()
    } else {
        let list = origins
            .split(',')
            .map(|o| HeaderValue::from_str(o.trim()))
            .collect::<Result<Vec<_>, _>>()?;
        AllowOrigin::list(list)
    };
    Ok(CorsLayer::new()
        .allow_origin(allow)
        .allow_methods([Method::GET, Method::HEAD, Method::OPTIONS])
        .allow_headers([axum::http::header::IF_NONE_MATCH])
        .expose_headers([axum::http::header::ETAG, HeaderName::from_static("x-request-id")])
        .max_age(Duration::from_secs(86400)))
}

/// Scalar API reference, loading the spec from /openapi.json.
fn scalar_html() -> &'static str {
    r#"<!doctype html>
<html>
  <head>
    <title>Mutual Fund Analytics API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>"#
}

