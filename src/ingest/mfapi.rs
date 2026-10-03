//! Client for https://api.mfapi.in (see https://www.mfapi.in/docs/).
//!
//! Endpoints used:
//! - `GET /mf/latest`: newest NAV + metadata for every scheme (~11 MB, one call per day).
//! - `GET /mf/{code}[?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD]`: NAV history.
//!   Unknown codes return HTTP 200 with an empty `data` array.

use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use chrono::NaiveDate;
use rand::RngExt;
use serde::Deserialize;
use tracing::warn;

const MAX_ATTEMPTS: u32 = 6;

#[derive(Clone)]
pub struct MfApi {
    http: reqwest::Client,
    base: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestItem {
    pub scheme_code: u32,
    #[serde(default)]
    pub scheme_name: Option<String>,
    #[serde(default)]
    pub fund_house: Option<String>,
    #[serde(default)]
    pub scheme_type: Option<String>,
    #[serde(default)]
    pub scheme_category: Option<String>,
    #[serde(default)]
    pub isin_growth: Option<String>,
    #[serde(default)]
    pub isin_div_reinvestment: Option<String>,
    #[serde(default)]
    pub nav: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct History {
    #[serde(default)]
    pub data: Vec<NavPoint>,
}

#[derive(Debug, Deserialize)]
pub struct NavPoint {
    pub date: String,
    pub nav: String,
}

impl MfApi {
    pub fn new(base: &str) -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("mf-pipeline/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .pool_max_idle_per_host(32)
            .build()?;
        Ok(Self { http, base: base.trim_end_matches('/').to_string() })
    }

    pub async fn latest(&self) -> Result<Vec<LatestItem>> {
        self.get_json(&format!("{}/mf/latest", self.base), &[]).await
    }

    pub async fn history(
        &self,
        scheme_code: u32,
        range: Option<(NaiveDate, NaiveDate)>,
    ) -> Result<History> {
        let url = format!("{}/mf/{}", self.base, scheme_code);
        let query: Vec<(&str, String)> = match range {
            Some((start, end)) => vec![
                ("startDate", start.format("%Y-%m-%d").to_string()),
                ("endDate", end.format("%Y-%m-%d").to_string()),
            ],
            None => vec![],
        };
        self.get_json(&url, &query).await
    }

    /// GET with retries on transport errors, 429 and 5xx (exponential backoff + jitter).
    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        query: &[(&str, String)],
    ) -> Result<T> {
        let mut attempt = 0;
        loop {
            attempt += 1;
            let result = async {
                let resp = self.http.get(url).query(query).send().await?;
                let status = resp.status();
                if status.is_success() {
                    let bytes = resp.bytes().await?;
                    return serde_json::from_slice::<T>(&bytes)
                        .map_err(|e| Failure::Fatal(anyhow!("invalid JSON from {url}: {e}")));
                }
                let err = anyhow!("HTTP {status} from {url}");
                if status.as_u16() == 429 || status.is_server_error() {
                    Err(Failure::Retry(err))
                } else {
                    Err(Failure::Fatal(err))
                }
            }
            .await;

            match result {
                Ok(v) => return Ok(v),
                Err(Failure::Fatal(e)) => return Err(e),
                Err(Failure::Retry(e)) if attempt < MAX_ATTEMPTS => {
                    let backoff = 500u64 * 2u64.pow(attempt - 1);
                    let jitter = rand::rng().random_range(0..=backoff / 2);
                    warn!(%url, attempt, error = %e, "retrying mfapi request");
                    tokio::time::sleep(Duration::from_millis(backoff + jitter)).await;
                }
                Err(Failure::Retry(e)) => {
                    return Err(e).with_context(|| format!("giving up after {attempt} attempts"));
                }
            }
        }
    }
}

enum Failure {
    Retry(anyhow::Error),
    Fatal(anyhow::Error),
}

impl From<reqwest::Error> for Failure {
    fn from(e: reqwest::Error) -> Self {
        // Timeouts, connection resets and truncated bodies are transient.
        Failure::Retry(e.into())
    }
}
