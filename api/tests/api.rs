//! End-to-end API tests: seed the pipeline's synthetic funds into a scratch database, compute
//! the metric views, build the real router (which validates every endpoint query) and call it
//! in-process. Needs MF_CLICKHOUSE_URL (./dev.sh test sets it); skipped otherwise.

use std::path::PathBuf;

use anyhow::Result;
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use mf::testing::{calendar_growth, d, end};
use serde_json::Value;
use tower::ServiceExt;

const DB: &str = "mf_api_test";

fn api_config(redis_url: String) -> mf_api::config::Config {
    mf_api::config::Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        clickhouse_url: std::env::var("MF_CLICKHOUSE_URL").unwrap(),
        clickhouse_user: std::env::var("MF_CLICKHOUSE_USER").unwrap_or("mf".into()),
        clickhouse_password: std::env::var("MF_CLICKHOUSE_PASSWORD").unwrap_or("mf_local_password".into()),
        clickhouse_database: DB.into(),
        cors_origins: "*".into(),
        redis_url,
        cache_ttl: 600,
        cache_max_age: 300,
        request_timeout: 20,
        max_db_queries: 16,
        public_url: "http://test".into(),
    }
}

async fn setup() -> Result<Option<Router>> {
    let Ok(url) = std::env::var("MF_CLICKHOUSE_URL") else {
        eprintln!("MF_CLICKHOUSE_URL not set; skipping API tests");
        return Ok(None);
    };
    let user = std::env::var("MF_CLICKHOUSE_USER").unwrap_or("mf".into());
    let password = std::env::var("MF_CLICKHOUSE_PASSWORD").unwrap_or("mf_local_password".into());

    let settings = mf::config::Settings {
        clickhouse_url: url.clone(),
        clickhouse_user: user.clone(),
        clickhouse_password: password.clone(),
        clickhouse_database: DB.into(),
        api_base: String::new(),
        concurrency: 1,
        schedule: String::new(),
        timezone: "UTC".into(),
        run_on_start: false,
        config_dir: PathBuf::from("config"),
    };
    let db = mf::db::Db::connect(&settings).await?;
    db.exec(&format!("DROP DATABASE IF EXISTS {DB} SYNC")).await?;
    let db = mf::db::Db::connect(&settings).await?;
    mf::db::migrate::run(&db).await?;
    mf::testing::seed(&db).await?;
    mf::orchestration::refresh::run(&db, &Default::default(), None).await?;

    let redis = std::env::var("MF_REDIS_URL").expect("MF_REDIS_URL (./dev.sh sets it) is needed for cache tests");
    let cfg = api_config(redis);
    let (_state, app) = mf_api::build(cfg).await?;
    Ok(Some(app))
}

struct Resp {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    json: Value,
}

async fn get(app: &Router, uri: &str) -> Resp {
    get_with(app, uri, None).await
}

async fn get_with(app: &Router, uri: &str, if_none_match: Option<&str>) -> Resp {
    request(app, "GET", uri, if_none_match).await
}

async fn request(app: &Router, method: &str, uri: &str, if_none_match: Option<&str>) -> Resp {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(tag) = if_none_match {
        req = req.header(header::IF_NONE_MATCH, tag);
    }
    let resp = app.clone().oneshot(req.body(Body::empty()).unwrap()).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
    Resp { status, headers, json }
}

fn f(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("not a number: {v}"))
}

fn close(actual: f64, expected: f64, tol: f64, what: &str) {
    assert!((actual - expected).abs() <= tol, "{what}: expected {expected}, got {actual}");
}

#[tokio::test]
async fn api_serves_correct_metrics() -> Result<()> {
    let Some(app) = setup().await? else { return Ok(()) };

    // Dataset summary.
    let meta = get(&app, "/v1/meta").await;
    assert_eq!(meta.status, StatusCode::OK);
    assert_eq!(meta.json["data"]["schemes"], 10);
    assert_eq!(meta.json["meta"]["as_of_date"], "2026-09-30");

    // Search: every word must match; Direct Growth first.
    let s = get(&app, "/v1/schemes?q=steady%20large").await;
    let names: Vec<&str> = s.json["data"].as_array().unwrap().iter().map(|r| r["scheme_name"].as_str().unwrap()).collect();
    assert_eq!(s.json["meta"]["total"], 3);
    assert_eq!(names[0], "Test Steady Large Cap Fund - Direct Plan - Growth");
    assert_eq!(get(&app, "/v1/schemes?q=9004").await.json["data"][0]["scheme_code"], 9004);

    // Scheme detail matches closed-form answers.
    let detail = get(&app, "/v1/schemes/9004").await.json["data"].clone();
    let expected_3y = (calendar_growth(10.0, 0.12, end()) / calendar_growth(10.0, 0.12, d("2023-09-29"))).powf(1.0 / 3.0) - 1.0;
    close(f(&detail["cagr_3y"]), expected_3y, 1e-12, "cagr_3y");
    assert_eq!(detail["return_basis"], "total");
    assert_eq!(detail["regular_plan_code"], 9005);
    assert_eq!(detail["category"], "Large Cap Fund");
    let idcw = get(&app, "/v1/schemes/9006").await.json["data"].clone();
    assert_eq!(idcw["return_basis"], "price");
    assert_eq!(idcw["growth_option_code"], 9004);

    // Errors are problem+json.
    let missing = get(&app, "/v1/schemes/1234567").await;
    assert_eq!(missing.status, StatusCode::NOT_FOUND);
    assert_eq!(missing.headers[header::CONTENT_TYPE], "application/problem+json");
    assert_eq!(get(&app, "/v1/schemes/1234567/returns").await.status, StatusCode::NOT_FOUND);
    assert_eq!(get(&app, "/v1/schemes/abc").await.status, StatusCode::BAD_REQUEST);
    for bad in ["/v1/screener?typo=1", "/v1/screener?min_scheme_name=1", "/v1/screener?sort=nope", "/v1/screener?limit=0"] {
        assert_eq!(get(&app, bad).await.status, StatusCode::BAD_REQUEST, "{bad}");
    }

    // SIP into an asset compounding at exactly 12% has an XIRR of exactly 12%.
    let sip = get(&app, "/v1/schemes/9004/sip/calculate?amount=10000&start=2023-10&end=2026-08&schedule=true").await;
    assert_eq!(sip.status, StatusCode::OK, "{}", sip.json);
    close(f(&sip.json["data"]["xirr"]), 0.12, 1e-6, "SIP XIRR");
    assert_eq!(sip.json["data"]["installments"], 35);
    assert_eq!(sip.json["data"]["schedule"].as_array().unwrap().len(), 35);

    // Lumpsum: value grows exactly with the NAV.
    let lump = get(&app, "/v1/schemes/9004/lumpsum/calculate?amount=100000&date=2021-09-30").await.json["data"].clone();
    let ratio = calendar_growth(10.0, 0.12, end()) / calendar_growth(10.0, 0.12, d("2021-09-30"));
    close(f(&lump["current_value"]), 100_000.0 * ratio, 1e-6, "lumpsum value");

    // Rolling 1Y returns of a 12%-a-year fund stay at ~12% (start NAVs fall on business days).
    let roll = get(&app, "/v1/schemes/9004/rolling/1Y?interval=month").await.json["data"].clone();
    for p in roll.as_array().unwrap() {
        close(f(&p["fund_return"]), 0.12, 0.002, "rolling 1Y");
    }

    // A x100 face-value change: published NAV jumps, the restated series does not.
    let nav = get(&app, "/v1/schemes/9010/nav?from=2024-01-12&to=2024-01-15").await.json["data"].clone();
    let (before, after) = (&nav[0], &nav[1]);
    close(f(&after["published_nav"]) / f(&before["published_nav"]), 100.0, 1.0, "published jump");
    close(f(&after["nav"]) / f(&before["nav"]), 1.0, 0.01, "restated continuity");

    // Screener: filters, sort and field selection.
    let scr = get(&app, "/v1/screener?category=Large%20Cap%20Fund&plan=Direct&peer_only=true&sort=-cagr_3y&fields=scheme_name,cagr_3y").await;
    let rows = scr.json["data"].as_array().unwrap();
    assert!(!rows.is_empty());
    let cagrs: Vec<f64> = rows.iter().filter_map(|r| r["cagr_3y"].as_f64()).collect();
    assert!(cagrs.windows(2).all(|w| w[0] >= w[1]), "sorted descending: {cagrs:?}");
    assert_eq!(rows[0].as_object().unwrap().len(), 3, "scheme_code + requested fields");
    // Text sorts ignore case (AMCs publish some names in capitals), both directions.
    for (sort, rev) in [("scheme_name", false), ("-scheme_name", true)] {
        let r = get(&app, &format!("/v1/screener?active=false&sort={sort}&fields=scheme_name&limit=500")).await;
        let names: Vec<String> = r.json["data"].as_array().unwrap().iter().map(|r| r["scheme_name"].as_str().unwrap().to_lowercase()).collect();
        let mut want = names.clone();
        want.sort();
        if rev {
            want.reverse();
        }
        assert!(names.len() > 1);
        assert_eq!(names, want, "case-insensitive {sort}");
    }
    let band = get(&app, "/v1/screener?min_cagr_3y=0.119&max_cagr_3y=0.121&active=false").await;
    let codes: Vec<u64> = band.json["data"].as_array().unwrap().iter().map(|r| r["scheme_code"].as_u64().unwrap()).collect();
    assert!(codes.contains(&9004) && !codes.contains(&9005), "{codes:?}");

    // Compare growth: rebased to ~100 at the common start; the 12% plan ends above the 11% plan.
    let g = get(&app, "/v1/compare/growth?codes=9004,9005&from=2024-01-01&interval=month").await.json["data"].clone();
    let last = |i: usize| f(&g[i]["series"].as_array().unwrap().last().unwrap()["value"]);
    close(f(&g[0]["series"][0]["value"]), 100.0, 2.0, "rebased start");
    assert!(last(0) > last(1));

    // HTTP caching: second request is a cache hit, conditional request gets 304.
    let first = get(&app, "/v1/schemes/9004/returns").await;
    assert_eq!(first.headers["x-cache"], "miss");
    let second = get(&app, "/v1/schemes/9004/returns").await;
    assert_eq!(second.headers["x-cache"], "hit");
    let tag = first.headers[header::ETAG].to_str().unwrap().to_string();
    assert_eq!(get_with(&app, "/v1/schemes/9004/returns", Some(&tag)).await.status, StatusCode::NOT_MODIFIED);

    // Redis is shared: a second replica gets the first one's entries.
    let replica = mf_api::build(api_config(std::env::var("MF_REDIS_URL")?)).await?.1;
    assert_eq!(get(&replica, "/v1/schemes/9004/returns").await.headers["x-cache"], "hit");
    // Redis down: requests are still served (uncached), never failed.
    let no_redis = mf_api::build(api_config("redis://127.0.0.1:1/0".into())).await?.1;
    let r = get(&no_redis, "/v1/schemes/9004/returns").await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.headers["x-cache"], "bypass");

    // --- regressions from the API review ---
    // conditional requests never turn a failing request into 304; weak comparison; Vary on 304
    assert_eq!(get_with(&app, "/v1/schemes/abc", Some("*")).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(get_with(&app, "/v1/schemes/1234567", Some("*")).await.status, StatusCode::NOT_FOUND);
    let strong = tag.trim_start_matches("W/").to_string();
    let not_modified = get_with(&app, "/v1/schemes/9004/returns", Some(&strong)).await;
    assert_eq!(not_modified.status, StatusCode::NOT_MODIFIED);
    assert!(not_modified.headers[header::VARY].to_str()?.contains("accept-encoding"));
    // HEAD shares GET's cache entry; parameter order does not fragment the cache
    assert_eq!(request(&app, "HEAD", "/v1/schemes/9004/returns", None).await.headers["x-cache"], "hit");
    get(&app, "/v1/schemes/9004/nav?interval=month&from=2024-01-01").await;
    assert_eq!(get(&app, "/v1/schemes/9004/nav?from=2024-01-01&interval=month").await.headers["x-cache"], "hit");
    // one installment before the valuation date is enough for an XIRR
    let single = get(&app, "/v1/schemes/9004/sip/calculate?amount=10000&start=2023-10&end=2023-10").await;
    close(f(&single.json["data"]["xirr"]), 0.12, 1e-6, "single-installment XIRR");
    // default end month comes from the data (month before the latest NAV), not the clock
    let dflt = get(&app, "/v1/schemes/9004/sip/calculate?amount=10000&start=2026-06").await;
    assert_eq!(dflt.json["data"]["installments"], 3, "Jun-Aug 2026: {}", dflt.json);
    // explicit interval=day is honoured
    let daily = get(&app, "/v1/schemes/9004/rolling/1Y?interval=day&from=2026-09-01").await;
    let weekly = get(&app, "/v1/schemes/9004/rolling/1Y?from=2026-09-01").await;
    assert!(daily.json["data"].as_array().unwrap().len() > weekly.json["data"].as_array().unwrap().len());
    // a page past the end still reports the true total
    let past = get(&app, "/v1/schemes?q=steady&limit=1&offset=10").await;
    assert_eq!(past.json["meta"]["total"], 3);
    assert_eq!(past.json["data"].as_array().unwrap().len(), 0);
    // every search word is honoured (more than 8 words are rejected)
    assert_eq!(get(&app, "/v1/schemes?q=a%20b%20c%20d%20e%20f%20g%20h%20i").await.status, StatusCode::BAD_REQUEST);
    // unknown parameters on typed endpoints are rejected
    assert_eq!(get(&app, "/v1/schemes/9004/nav?intervall=week").await.status, StatusCode::BAD_REQUEST);

    // OpenAPI: every operation documents its response schema.
    let doc = get(&app, "/openapi.json").await.json;
    assert_eq!(doc["paths"].as_object().unwrap().len(), 29);
    assert!(doc["components"]["schemas"]["SchemeRow"]["properties"]["cagr_3y"].is_object());
    assert!(doc["components"]["schemas"]["Interval"].is_object(), "parameter schemas kept");
    assert_eq!(doc["components"]["schemas"]["ScreenRow"]["required"], serde_json::json!(["scheme_code"]));
    let sip_req = doc["components"]["schemas"]["CalculateSipRow"]["required"].as_array().unwrap();
    assert!(!sip_req.iter().any(|r| r == "schedule"));
    Ok(())
}

/// A new data version deletes the stored responses of every other version.
#[tokio::test]
async fn purging_removes_only_other_versions() -> anyhow::Result<()> {
    use mf_api::store::{CacheStatus, CachedResponse, ResponseStore};
    // Its own Redis database: a purge must not delete entries the other cache tests rely on.
    let url = std::env::var("MF_REDIS_URL")?;
    let url = format!("{}/14", url.rsplit_once('/').map_or(url.as_str(), |(base, _)| base));
    let store = ResponseStore::new(&url, 60)?;
    let body = || async { Ok(CachedResponse { content_type: "application/json".into(), body: bytes::Bytes::from_static(b"{}") }) };
    let (old, new) = (ResponseStore::key("purge-test-old", "/x"), ResponseStore::key("purge-test-new", "/x"));
    store.get_or_load(&old, body()).await;
    store.get_or_load(&new, body()).await;
    assert!(store.purge_other_versions("purge-test-new").await >= 1);
    assert_eq!(store.get_or_load(&new, body()).await.1, CacheStatus::Hit, "current version kept");
    assert_eq!(store.get_or_load(&old, body()).await.1, CacheStatus::Miss, "other version deleted");
    store.purge_other_versions("purge-test-unused").await; // leave database 14 empty
    Ok(())
}
