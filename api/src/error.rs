//! Errors rendered as RFC 9457 problem details (`application/problem+json`).

use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("the data store is unavailable")]
    Unavailable(#[source] anyhow::Error),
    #[error("too many requests in flight; retry shortly")]
    Overloaded,
    #[error("internal error")]
    Internal(#[source] anyhow::Error),
}

impl ApiError {
    pub fn bad(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unavailable(_) | Self::Overloaded => StatusCode::SERVICE_UNAVAILABLE,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl From<clickhouse::error::Error> for ApiError {
    fn from(e: clickhouse::error::Error) -> Self {
        match e {
            clickhouse::error::Error::Network(_) | clickhouse::error::Error::TimedOut => {
                Self::Unavailable(e.into())
            }
            _ => Self::Internal(e.into()),
        }
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(e: serde_json::Error) -> Self {
        Self::Internal(e.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        if status.is_server_error() {
            // Internal details go to the log, not to clients.
            let source = std::error::Error::source(&self).map(|s| format!("{s:#}")).unwrap_or_default();
            tracing::error!(error = %self, %source, "request failed");
        }
        let body = json!({
            "type": "about:blank",
            "title": status.canonical_reason().unwrap_or("Error"),
            "status": status.as_u16(),
            "detail": self.to_string(),
        });
        let mut resp =
            (status, [(header::CONTENT_TYPE, "application/problem+json")], body.to_string()).into_response();
        if matches!(self, Self::Overloaded) {
            resp.headers_mut().insert(header::RETRY_AFTER, axum::http::HeaderValue::from_static("2"));
        }
        resp
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
