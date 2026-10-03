use std::net::SocketAddr;

/// Runtime settings, all overridable through `MF_API_*` environment variables.
#[derive(clap::Parser, Debug, Clone)]
#[command(name = "mf-api", about = "Read-only REST API over the mutual fund ClickHouse tables")]
pub struct Config {
    #[arg(long, env = "MF_API_BIND", default_value = "0.0.0.0:8080")]
    pub bind: SocketAddr,
    #[arg(long, env = "MF_API_CLICKHOUSE_URL", default_value = "http://localhost:18123")]
    pub clickhouse_url: String,
    /// Use the read-only `mf_api` account (docker/clickhouse/users.d/mf-api.xml).
    #[arg(long, env = "MF_API_CLICKHOUSE_USER", default_value = "mf_api")]
    pub clickhouse_user: String,
    #[arg(long, env = "MF_API_CLICKHOUSE_PASSWORD", default_value = "mf_api_local_password", hide_env_values = true)]
    pub clickhouse_password: String,
    #[arg(long, env = "MF_API_CLICKHOUSE_DATABASE", default_value = "mf")]
    pub clickhouse_database: String,
    /// Allowed CORS origins, comma-separated, or `*` for any.
    #[arg(long, env = "MF_API_CORS_ORIGINS", default_value = "*")]
    pub cors_origins: String,
    /// Redis for the shared response cache, e.g. `redis://redis:6379/0`. Empty disables caching.
    /// Unreachable Redis is tolerated: requests are served uncached.
    #[arg(long, env = "MF_API_REDIS_URL", default_value = "redis://localhost:6379/0")]
    pub redis_url: String,
    /// Lifetime of stored responses in seconds. Keys include the data version, so this only
    /// bounds how long superseded entries linger (default 26 h, just over one daily cycle).
    #[arg(long, env = "MF_API_CACHE_TTL", default_value_t = 93_600)]
    pub cache_ttl: u64,
    /// `max-age` sent to browsers and CDNs, in seconds.
    #[arg(long, env = "MF_API_CACHE_MAX_AGE", default_value_t = 300)]
    pub cache_max_age: u32,
    /// Per-request timeout in seconds (ClickHouse itself stops queries after 15 s).
    #[arg(long, env = "MF_API_REQUEST_TIMEOUT", default_value_t = 20)]
    pub request_timeout: u64,
    /// Database queries allowed at once; more wait up to 2 s, then get 503 (load shedding).
    #[arg(long, env = "MF_API_MAX_DB_QUERIES", default_value_t = 16)]
    pub max_db_queries: usize,
    /// Public base URL advertised in the OpenAPI document.
    #[arg(long, env = "MF_API_PUBLIC_URL", default_value = "http://localhost:8080")]
    pub public_url: String,
}
