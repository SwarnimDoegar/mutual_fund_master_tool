//! Response store backed by Redis, shared by every API replica.
//!
//! * Keys are `mfapi:v1:<data version>#<path>?<sorted query>`. A metric refresh changes the data
//!   version, so stale entries are never read again and expire through their TTL.
//! * Fail-open: every Redis call has a short timeout; if Redis is slow or down the request is
//!   served from ClickHouse and marked `x-cache: bypass`, never failed.
//! * Concurrent misses for the same key in one process run the handler once (single flight);
//!   the other requests wait for and share its result.

use std::collections::HashMap;
use std::future::Future;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::{BufMut, Bytes, BytesMut};
use redis::aio::{ConnectionManager, ConnectionManagerConfig};
use tokio::sync::OnceCell;

/// A cacheable (200) response.
#[derive(Clone, Debug)]
pub struct CachedResponse {
    pub content_type: String,
    pub body: Bytes,
}

/// A response that must not be cached (any non-200), passed back to the caller as-is.
#[derive(Debug)]
pub struct Uncacheable {
    pub status: axum::http::StatusCode,
    pub headers: axum::http::HeaderMap,
    pub body: Bytes,
}

pub type LoadResult = Result<CachedResponse, Arc<Uncacheable>>;

/// Outcome of a lookup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CacheStatus {
    /// Served from Redis, or from another request's in-flight load.
    Hit,
    /// This request ran the handler and stored the result.
    Miss,
    /// Redis unavailable: the handler ran and nothing was stored.
    Bypass,
}

impl CacheStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            CacheStatus::Hit => "hit",
            CacheStatus::Miss => "miss",
            CacheStatus::Bypass => "bypass",
        }
    }
}

const KEY_PREFIX: &str = "mfapi:v1:";
/// Redis is local and the request path waits on it, so keep this tight.
const OP_TIMEOUT: Duration = Duration::from_millis(150);
/// Bodies above this are served but not stored (the largest real response is ~200 KB).
const MAX_STORED_BODY: usize = 8 * 1024 * 1024;

type Flight = Arc<OnceCell<LoadResult>>;

#[derive(Clone)]
pub struct ResponseStore {
    conn: Option<ConnectionManager>,
    ttl_secs: u64,
    /// In-flight loads by cache key (single flight within this process).
    inflight: Arc<Mutex<HashMap<String, Flight>>>,
}

impl ResponseStore {
    /// `url` empty disables Redis (every request is a bypass). Connection is lazy, so the API
    /// starts even when Redis is not up yet.
    pub fn new(url: &str, ttl_secs: u64) -> anyhow::Result<Self> {
        let conn = if url.trim().is_empty() {
            None
        } else {
            let client = redis::Client::open(url)?;
            let config = ConnectionManagerConfig::new()
                .set_connection_timeout(Some(Duration::from_millis(500)))
                .set_response_timeout(Some(OP_TIMEOUT))
                .set_number_of_retries(2)
                .set_max_delay(Duration::from_secs(2));
            Some(client.get_connection_manager_lazy(config)?)
        };
        Ok(Self { conn, ttl_secs, inflight: Arc::new(Mutex::new(HashMap::new())) })
    }

    pub fn key(version: &str, path_and_query: &str) -> String {
        format!("{KEY_PREFIX}{version}#{path_and_query}")
    }

    /// Weak ETag for a key. DefaultHasher::new() has fixed keys, so all replicas agree.
    pub fn etag(key: &str) -> String {
        let mut h = DefaultHasher::new();
        key.hash(&mut h);
        format!("W/\"{:016x}\"", h.finish())
    }

    /// Return the stored response, or run `load` once (per process and key) and store a success.
    pub async fn get_or_load<F>(&self, key: &str, load: F) -> (LoadResult, CacheStatus)
    where
        F: Future<Output = Result<CachedResponse, Uncacheable>>,
    {
        let redis_up = match self.get(key).await {
            Ok(Some(hit)) => return (Ok(hit), CacheStatus::Hit),
            Ok(None) => true,
            Err(()) => false,
        };

        let flight: Flight = self.inflight.lock().unwrap().entry(key.to_string()).or_default().clone();

        let mut ran_here = false;
        let result = flight
            .get_or_init(|| async {
                ran_here = true;
                let r = load.await.map_err(Arc::new);
                if let Ok(resp) = &r {
                    if redis_up {
                        self.set(key, resp).await;
                    }
                }
                r
            })
            .await
            .clone();

        {
            let mut map = self.inflight.lock().unwrap();
            // only the flight we joined is removed; a newer one may already exist
            if map.get(key).is_some_and(|existing| Arc::ptr_eq(existing, &flight)) {
                map.remove(key);
            }
        }

        let status = match (ran_here, redis_up) {
            (false, _) => CacheStatus::Hit,
            (true, true) => CacheStatus::Miss,
            (true, false) => CacheStatus::Bypass,
        };
        (result, status)
    }

    /// `Ok(None)` = miss, `Err(())` = Redis unavailable (treated as bypass).
    async fn get(&self, key: &str) -> Result<Option<CachedResponse>, ()> {
        let Some(conn) = &self.conn else { return Err(()) };
        let mut conn = conn.clone();
        let mut cmd = redis::cmd("GET");
        cmd.arg(key);
        let fut = cmd.query_async::<Option<Vec<u8>>>(&mut conn);
        match tokio::time::timeout(OP_TIMEOUT, fut).await {
            Ok(Ok(Some(raw))) => Ok(decode(&raw)),
            Ok(Ok(None)) => Ok(None),
            Ok(Err(e)) => {
                tracing::warn!(error = %e, "redis GET failed; serving uncached");
                Err(())
            }
            Err(_) => {
                tracing::warn!("redis GET timed out; serving uncached");
                Err(())
            }
        }
    }

    async fn set(&self, key: &str, resp: &CachedResponse) {
        if resp.body.len() > MAX_STORED_BODY {
            return;
        }
        let Some(conn) = &self.conn else { return };
        let mut conn = conn.clone();
        let mut cmd = redis::cmd("SET");
        cmd.arg(key).arg(encode(resp).as_ref()).arg("EX").arg(self.ttl_secs);
        let fut = cmd.query_async::<()>(&mut conn);
        match tokio::time::timeout(OP_TIMEOUT, fut).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => tracing::warn!(error = %e, "redis SET failed"),
            Err(_) => tracing::warn!("redis SET timed out"),
        }
    }

    /// For readiness/diagnostics: is Redis answering?
    pub async fn ping(&self) -> bool {
        let Some(conn) = &self.conn else { return false };
        let mut conn = conn.clone();
        let cmd = redis::cmd("PING");
        let fut = cmd.query_async::<String>(&mut conn);
        matches!(tokio::time::timeout(OP_TIMEOUT, fut).await, Ok(Ok(_)))
    }
}

/// `[content-type length: u16 BE][content-type][body]`
fn encode(resp: &CachedResponse) -> Bytes {
    let ct = resp.content_type.as_bytes();
    let ct_len = ct.len().min(u16::MAX as usize);
    let mut buf = BytesMut::with_capacity(2 + ct_len + resp.body.len());
    buf.put_u16(ct_len as u16);
    buf.put_slice(&ct[..ct_len]);
    buf.put_slice(&resp.body);
    buf.freeze()
}

fn decode(raw: &[u8]) -> Option<CachedResponse> {
    let len = u16::from_be_bytes(raw.get(..2)?.try_into().ok()?) as usize;
    let ct = std::str::from_utf8(raw.get(2..2 + len)?).ok()?.to_string();
    Some(CachedResponse { content_type: ct, body: Bytes::copy_from_slice(&raw[2 + len..]) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_encoding() {
        let r = CachedResponse { content_type: "application/json".into(), body: Bytes::from_static(b"{\"a\":1}") };
        let d = decode(&encode(&r)).unwrap();
        assert_eq!(d.content_type, r.content_type);
        assert_eq!(d.body, r.body);
        assert!(decode(b"\x00").is_none());
    }

    #[tokio::test]
    async fn concurrent_misses_run_the_loader_once_without_redis() {
        let store = ResponseStore::new("", 60).unwrap();
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut handles = vec![];
        for _ in 0..8 {
            let (store, calls) = (store.clone(), calls.clone());
            handles.push(tokio::spawn(async move {
                store
                    .get_or_load("k", async {
                        calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        Ok(CachedResponse { content_type: "x".into(), body: Bytes::from_static(b"1") })
                    })
                    .await
                    .1
            }));
        }
        let mut statuses = vec![];
        for h in handles {
            statuses.push(h.await.unwrap());
        }
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(statuses.iter().filter(|s| **s == CacheStatus::Bypass).count(), 1);
        assert_eq!(statuses.iter().filter(|s| **s == CacheStatus::Hit).count(), 7);
    }
}
