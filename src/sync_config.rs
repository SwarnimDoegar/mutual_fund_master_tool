//! Copies `config/settings.toml` and `config/categories.csv` into ClickHouse tables that the
//! metric views read (`settings`, `benchmark_proxy`, `category_map`).

use anyhow::Result;
use clickhouse::Row;
use serde::Serialize;
use tracing::info;

use crate::config::Settings;
use crate::db::Db;

#[derive(Row, Serialize)]
struct SettingRow {
    key: String,
    value: f64,
}

#[derive(Row, Serialize)]
struct ProxyRow {
    category: String,
    scheme_code: u32,
    index_name: String,
}

#[derive(Row, Serialize)]
struct CategoryRow {
    raw_category: String,
    asset_class: String,
    category: String,
    rankable: u8,
}

pub async fn run(db: &Db, settings: &Settings) -> Result<()> {
    let cfg = settings.load_analytics()?;
    let categories = settings.load_categories()?;
    let a = &cfg.analytics;

    let rows = [
        ("risk_free_fallback_rate", a.risk_free_fallback_rate),
        ("risk_free_proxy_scheme_code", a.risk_free_proxy_scheme_code as f64),
        ("sip_monthly_amount", a.sip_monthly_amount),
        ("active_within_days", a.active_within_days as f64),
        ("glitch_min_move", a.glitch_min_move),
        ("glitch_max_reversal", a.glitch_max_reversal),
        ("idcw_min_gap", a.idcw_min_gap),
    ];

    db.exec("TRUNCATE TABLE settings").await?;
    let mut ins = db.client.insert::<SettingRow>("settings").await?;
    for (key, value) in rows {
        ins.write(&SettingRow { key: key.into(), value }).await?;
    }
    ins.end().await?;

    db.exec("TRUNCATE TABLE benchmark_proxy").await?;
    let mut ins = db.client.insert::<ProxyRow>("benchmark_proxy").await?;
    for b in &cfg.benchmark {
        ins.write(&ProxyRow {
            category: b.category.clone(),
            scheme_code: b.scheme_code,
            index_name: b.index.clone(),
        })
        .await?;
    }
    ins.end().await?;

    db.exec("TRUNCATE TABLE category_map").await?;
    let mut ins = db.client.insert::<CategoryRow>("category_map").await?;
    for c in &categories {
        ins.write(&CategoryRow {
            raw_category: c.raw_category.clone(),
            asset_class: c.asset_class.clone(),
            category: c.category.clone(),
            rankable: c.rankable,
        })
        .await?;
    }
    ins.end().await?;

    info!(
        benchmarks = cfg.benchmark.len(),
        categories = categories.len(),
        "config synced"
    );
    Ok(())
}
