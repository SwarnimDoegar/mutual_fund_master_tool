//! Versioned SQL migrations embedded from `sql/migrations/NNNN_name.sql`.
//!
//! Applied migrations are recorded with a checksum; editing an applied file is an error.
//! Change views by adding a new migration that drops and recreates them.

use anyhow::{Context, Result, bail};
use clickhouse::Row;
use include_dir::{Dir, include_dir};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db::Db;

static MIGRATIONS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/sql/migrations");

#[derive(Row, Deserialize)]
struct Applied {
    version: u32,
    checksum: String,
}

#[derive(Row, Serialize)]
struct AppliedInsert {
    version: u32,
    name: String,
    checksum: String,
}

pub struct Migration {
    pub version: u32,
    pub name: String,
    pub sql: &'static str,
}

pub fn migrations() -> Result<Vec<Migration>> {
    let mut out = Vec::new();
    for file in MIGRATIONS.files() {
        let name = file.path().file_name().unwrap().to_string_lossy().to_string();
        if !name.ends_with(".sql") {
            continue;
        }
        let version: u32 = name
            .split('_')
            .next()
            .and_then(|v| v.parse().ok())
            .with_context(|| format!("migration {name} must start with a number"))?;
        let sql = file.contents_utf8().with_context(|| format!("{name} is not UTF-8"))?;
        out.push(Migration { version, name, sql });
    }
    out.sort_by_key(|m| m.version);
    for pair in out.windows(2) {
        if pair[0].version == pair[1].version {
            bail!("duplicate migration version {}", pair[0].version);
        }
    }
    Ok(out)
}

pub async fn run(db: &Db) -> Result<()> {
    db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version UInt32, name String, checksum String,
            applied_at DateTime64(3) DEFAULT now64(3)
        ) ENGINE = MergeTree ORDER BY version",
    )
    .await?;

    let applied: Vec<Applied> = db
        .client
        .query("SELECT version, checksum FROM schema_migrations ORDER BY version")
        .fetch_all()
        .await?;

    for m in migrations()? {
        let checksum = checksum(m.sql);
        if let Some(a) = applied.iter().find(|a| a.version == m.version) {
            if a.checksum != checksum {
                bail!(
                    "migration {} was edited after being applied; add a new migration instead",
                    m.name
                );
            }
            continue;
        }
        info!(migration = %m.name, "applying");
        for stmt in split_statements(m.sql) {
            db.exec(&stmt).await.with_context(|| format!("in migration {}", m.name))?;
        }
        let mut insert = db.client.insert::<AppliedInsert>("schema_migrations").await?;
        insert.write(&AppliedInsert { version: m.version, name: m.name.clone(), checksum }).await?;
        insert.end().await?;
    }
    Ok(())
}

/// FNV-1a 64 over the file contents; enough to detect edits.
fn checksum(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// Split a SQL script on `;`, ignoring semicolons inside quotes and comments.
pub fn split_statements(sql: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    let mut quote: Option<char> = None;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if let Some(q) = quote {
            cur.push(c);
            if c == '\\' {
                if let Some(n) = next {
                    cur.push(n);
                    i += 1;
                }
            } else if c == q {
                quote = None;
            }
        } else if c == '-' && next == Some('-') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            cur.push('\n');
        } else if c == '/' && next == Some('*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 1;
        } else if c == ';' {
            if !cur.trim().is_empty() {
                out.push(cur.trim().to_string());
            }
            cur.clear();
        } else {
            if c == '\'' || c == '"' || c == '`' {
                quote = Some(c);
            }
            cur.push(c);
        }
        i += 1;
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_semicolons_outside_strings_and_comments() {
        let sql = "CREATE TABLE a (x String DEFAULT 'a;b'); -- c;d\nSELECT 1 /* ; */; SELECT '\\';'";
        assert_eq!(
            split_statements(sql),
            vec!["CREATE TABLE a (x String DEFAULT 'a;b')", "SELECT 1", "SELECT '\\';'"]
        );
    }

    #[test]
    fn embedded_migrations_are_well_formed() {
        let ms = migrations().unwrap();
        assert!(!ms.is_empty());
        for m in &ms {
            assert!(!split_statements(m.sql).is_empty(), "{} is empty", m.name);
        }
    }
}
