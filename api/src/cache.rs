//! HTTP caching for read-only data that changes once a day.
//!
//! * Successful GET/HEAD responses are cached in memory under (data version, path, sorted query).
//!   Concurrent misses for the same key run the handler once (moka `try_get_with`).
//! * Each cached representation has a weak ETag derived from the same key. `If-None-Match` is
//!   answered with 304 only when that representation exists (a request that would fail never
//!   gets a 304) and uses weak comparison (RFC 9110 §13.1.2).
//! * Responses always vary on `Accept-Encoding` and `Origin`, including 304s, so shared caches
//!   never mix compressed and uncompressed bodies or CORS variants.
//! * A new pipeline refresh changes the data version, which changes every key and ETag at once.

use std::hash::{DefaultHasher, Hash, Hasher};

use axum::body::{Body, Bytes, to_bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::state::{AppState, CachedResponse};

const MAX_CACHED_BODY: usize = 32 * 1024 * 1024;
const VARY: &str = "accept-encoding, origin";

/// A non-200 response, carried through the cache loader without being stored.
#[derive(Debug)]
struct Uncached {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

pub async fn http_cache(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return next.run(req).await;
    }
    let key = cache_key(&state.version().tag(), &req);
    let etag = etag_for(&key);
    let cache_control = format!("public, max-age={}, stale-while-revalidate=86400", state.cfg.cache_max_age);
    let if_none_match = req
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    let mut was_hit = true;
    let loaded = state
        .cache
        .try_get_with(key, async {
            was_hit = false;
            let resp = next.run(req).await;
            let (parts, body) = resp.into_parts();
            let body = match to_bytes(body, MAX_CACHED_BODY).await {
                Ok(b) => b,
                Err(e) => {
                    tracing::error!(error = %e, "could not buffer response body");
                    return Err(Uncached {
                        status: StatusCode::INTERNAL_SERVER_ERROR,
                        headers: HeaderMap::new(),
                        body: Bytes::new(),
                    });
                }
            };
            if parts.status == StatusCode::OK {
                let content_type = parts
                    .headers
                    .get(header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("application/json")
                    .to_string();
                Ok(CachedResponse { content_type, body })
            } else {
                Err(Uncached { status: parts.status, headers: parts.headers, body })
            }
        })
        .await;

    let cached = match loaded {
        Ok(c) => c,
        Err(e) => {
            // errors are never cached and never get a validator
            let mut resp = Response::new(Body::from(e.body.clone()));
            *resp.status_mut() = e.status;
            *resp.headers_mut() = e.headers.clone();
            resp.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            return resp;
        }
    };

    let status = if was_hit { "hit" } else { "miss" };
    if if_none_match.as_deref().is_some_and(|v| etag_matches(v, &etag)) {
        let mut resp = StatusCode::NOT_MODIFIED.into_response();
        set_headers(&mut resp, &etag, &cache_control, status);
        return resp;
    }
    let mut resp = Response::new(Body::from(cached.body));
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&cached.content_type).unwrap_or(HeaderValue::from_static("application/json")),
    );
    set_headers(&mut resp, &etag, &cache_control, status);
    resp
}

/// Version + path + query pairs sorted, so parameter order doesn't fragment the cache.
/// HEAD shares GET's entries.
fn cache_key(version: &str, req: &Request) -> String {
    let uri = req.uri();
    let mut pairs: Vec<&str> = uri.query().unwrap_or("").split('&').filter(|p| !p.is_empty()).collect();
    pairs.sort_unstable();
    format!("{version}#{}?{}", uri.path(), pairs.join("&"))
}

/// Weak comparison: `W/"x"` and `"x"` match; `*` matches any existing representation.
fn etag_matches(header_value: &str, etag: &str) -> bool {
    let opaque = |t: &str| t.trim().trim_start_matches("W/").to_string();
    let ours = opaque(etag);
    header_value.split(',').any(|t| t.trim() == "*" || opaque(t) == ours)
}

fn set_headers(resp: &mut Response, etag: &str, cache_control: &str, status: &'static str) {
    let h = resp.headers_mut();
    if let Ok(v) = HeaderValue::from_str(etag) {
        h.insert(header::ETAG, v);
    }
    if let Ok(v) = HeaderValue::from_str(cache_control) {
        h.insert(header::CACHE_CONTROL, v);
    }
    h.insert(header::VARY, HeaderValue::from_static(VARY));
    h.insert("x-cache", HeaderValue::from_static(status));
}

fn etag_for(key: &str) -> String {
    // DefaultHasher::new() uses fixed keys, so ETags agree across replicas of the same build.
    let mut h = DefaultHasher::new();
    key.hash(&mut h);
    format!("W/\"{:016x}\"", h.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weak_etag_comparison() {
        let tag = "W/\"00ff\"";
        assert!(etag_matches("W/\"00ff\"", tag));
        assert!(etag_matches("\"00ff\"", tag));
        assert!(etag_matches("\"aa\", W/\"00ff\"", tag));
        assert!(etag_matches("*", tag));
        assert!(!etag_matches("\"00fe\"", tag));
    }

    #[test]
    fn query_order_does_not_change_the_key() {
        let a = Request::builder().uri("/v1/x?b=2&a=1").body(Body::empty()).unwrap();
        let b = Request::builder().uri("/v1/x?a=1&b=2").body(Body::empty()).unwrap();
        assert_eq!(cache_key("v", &a), cache_key("v", &b));
    }
}
