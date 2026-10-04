//! Rebuilds every derived table and view from the raw tables.
//!
//! The derived layer is a list of SQL files, `sql/derived/NNN_<name>.sql`, run in file-name
//! order. A file holds plain statements, usually one
//! `CREATE OR REPLACE TABLE <name> (columns) ENGINE = ... AS <query>`, which ClickHouse builds
//! in a temporary table and swaps in atomically: readers see the old table until the new one is
//! complete, and a failed query leaves the old table untouched. A few files define plain views
//! (`CREATE OR REPLACE VIEW`) or append to a history table (`INSERT INTO ... SELECT`).
//!
//! There is no other registry: adding a metric table means adding a file.

use std::time::Instant;

use anyhow::{Context, Result, bail};
use chrono::Utc;
use include_dir::{Dir, include_dir};
use tracing::info;

use crate::db::migrate::split_statements;
use crate::db::{Db, PipelineLogRow};

static DERIVED: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/sql/derived");

#[derive(clap::Args, Debug, Clone, Default)]
pub struct RefreshArgs {
    /// Start at this step and continue down the order (e.g. after fixing a failure).
    #[arg(long)]
    pub from: Option<String>,
    /// Run only these steps (comma-separated), still in order.
    #[arg(long, value_delimiter = ',')]
    pub only: Vec<String>,
}

/// One file of `sql/derived`: the step name is the file name without number and extension.
pub struct Step {
    pub name: String,
    pub sql: &'static str,
}

/// All steps in execution order.
pub fn steps() -> Result<Vec<Step>> {
    let mut files: Vec<_> = DERIVED
        .files()
        .filter(|f| f.path().extension().is_some_and(|e| e == "sql"))
        .collect();
    files.sort_by_key(|f| f.path().to_path_buf());
    let mut out: Vec<Step> = Vec::new();
    for f in files {
        let file = f.path().file_stem().unwrap().to_string_lossy();
        let name = file
            .split_once('_')
            .filter(|(n, _)| n.chars().all(|c| c.is_ascii_digit()))
            .map(|(_, name)| name.to_string())
            .with_context(|| format!("sql/derived/{file}.sql must be named NNN_<name>.sql"))?;
        anyhow::ensure!(!out.iter().any(|s| s.name == name), "duplicate step {name}");
        let sql = f.contents_utf8().with_context(|| format!("{file}.sql is not UTF-8"))?;
        out.push(Step { name, sql });
    }
    Ok(out)
}

pub async fn run(db: &Db, args: &RefreshArgs, run_id: Option<uuid::Uuid>) -> Result<()> {
    let mut steps = steps()?;
    if let Some(from) = &args.from {
        let pos = steps.iter().position(|s| &s.name == from).with_context(|| format!("unknown step {from}"))?;
        steps.drain(..pos);
    }
    if !args.only.is_empty() {
        for o in &args.only {
            anyhow::ensure!(steps.iter().any(|s| &s.name == o), "unknown step {o}");
        }
        steps.retain(|s| args.only.contains(&s.name));
    }

    let started_all = Utc::now();
    for step in steps {
        let started = Utc::now();
        let clock = Instant::now();
        let result = run_step(db, &step).await;
        if let Some(run_id) = run_id {
            db.log_step(PipelineLogRow {
                run_id,
                step: format!("refresh:{}", step.name),
                status: if result.is_ok() { "ok" } else { "error" }.into(),
                started_at: started,
                finished_at: Utc::now(),
                details: result.as_ref().err().map(|e| format!("{e:#}")).unwrap_or_default(),
            })
            .await?;
        }
        result.with_context(|| format!("refreshing {}", step.name))?;
        info!(step = step.name, seconds = format!("{:.1}", clock.elapsed().as_secs_f64()), "refreshed");
    }
    // Completion marker: the API derives its data version (cache keys, ETags) from this.
    db.log_step(PipelineLogRow {
        run_id: run_id.unwrap_or_else(uuid::Uuid::new_v4),
        step: "refresh".into(),
        status: "ok".into(),
        started_at: started_all,
        finished_at: Utc::now(),
        details: String::new(),
    })
    .await?;
    Ok(())
}

async fn run_step(db: &Db, step: &Step) -> Result<()> {
    for stmt in split_statements(step.sql) {
        if let Some(fill) = Fill::parse(&stmt) {
            check_columns(db, &fill).await?;
        }
        db.exec(&stmt).await?;
    }
    Ok(())
}

/// A statement that fills a table from a query: `CREATE OR REPLACE TABLE t (columns) ... AS\n<query>`
/// or `INSERT INTO t\n<query>` (by convention `AS` sits on its own line, one column per line).
#[derive(Debug, PartialEq)]
struct Fill<'a> {
    table: &'a str,
    /// Declared columns of a `CREATE`; `None` for an `INSERT` into an existing table.
    columns: Option<Vec<&'a str>>,
    query: &'a str,
}

impl<'a> Fill<'a> {
    fn parse(stmt: &'a str) -> Option<Self> {
        if let Some(rest) = stmt.strip_prefix("CREATE OR REPLACE TABLE ") {
            let table = rest.split(|c: char| c.is_whitespace() || c == '(').next().filter(|w| !w.is_empty())?;
            let (ddl, query) = rest.split_once("\nAS\n")?;
            let (_, body) = ddl.split_once('(')?;
            let (body, _) = body.rsplit_once("\n)")?;
            let columns = body
                .lines()
                .filter_map(|l| l.split_whitespace().next())
                .map(|c| c.trim_matches('`'))
                .collect();
            return Some(Self { table, columns: Some(columns), query });
        }
        let rest = stmt.strip_prefix("INSERT INTO ")?;
        let (table, query) = rest.split_once('\n')?;
        Some(Self { table: table.trim(), columns: None, query })
    }
}

/// `CREATE TABLE ... AS SELECT` and `INSERT ... SELECT` map columns by position, not by name.
/// Before running the statement, check that the query's column names equal the table's, so a
/// reordered or renamed column fails the step instead of replacing a good table with bad data.
async fn check_columns(db: &Db, fill: &Fill<'_>) -> Result<()> {
    let table_cols: Vec<String> = match &fill.columns {
        Some(cols) => cols.iter().map(|c| c.to_string()).collect(),
        None => describe(db, &format!("DESCRIBE TABLE {}", fill.table)).await?,
    };
    let query_cols = describe(db, &format!("DESCRIBE TABLE ({})", fill.query)).await?;
    if table_cols != query_cols {
        bail!(
            "columns of {} do not match its query by name:\n  table: {table_cols:?}\n  query: {query_cols:?}",
            fill.table
        );
    }
    Ok(())
}

async fn describe(db: &Db, sql: &str) -> Result<Vec<String>> {
    let bytes = db
        .client
        .query(&sql.replace('?', "??"))
        .fetch_bytes("TabSeparated")?
        .collect()
        .await
        .with_context(|| format!("describing: {}", crate::db::truncate(sql, 200)))?;
    Ok(String::from_utf8_lossy(&bytes)
        .lines()
        .filter_map(|l| l.split('\t').next().map(str::to_string))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_are_well_formed() {
        let steps = steps().unwrap();
        assert!(steps.iter().any(|s| s.name == "fund_metrics"));
        for s in &steps {
            for stmt in split_statements(s.sql) {
                let creates_table = stmt.starts_with("CREATE OR REPLACE TABLE ");
                let ok = creates_table || stmt.starts_with("CREATE OR REPLACE VIEW ") || stmt.starts_with("INSERT INTO ");
                assert!(ok, "{}: unexpected statement {}", s.name, crate::db::truncate(&stmt, 80));
                if creates_table || stmt.starts_with("INSERT INTO ") {
                    let fill = Fill::parse(&stmt).unwrap_or_else(|| panic!("{}: put `AS` on its own line", s.name));
                    assert!(fill.columns.is_none_or(|c| c.len() > 1), "{}: columns not found", s.name);
                }
            }
        }
    }

    #[test]
    fn parses_fill_statements() {
        let create = "CREATE OR REPLACE TABLE t\n(\n    a UInt8,\n\n    `b` Nullable(Float64)\n)\nENGINE = MergeTree\nORDER BY a\nAS\nSELECT 1 AS a, 2. AS b";
        assert_eq!(
            Fill::parse(create),
            Some(Fill { table: "t", columns: Some(vec!["a", "b"]), query: "SELECT 1 AS a, 2. AS b" })
        );
        assert_eq!(
            Fill::parse("INSERT INTO h\nSELECT 1 AS a"),
            Some(Fill { table: "h", columns: None, query: "SELECT 1 AS a" })
        );
        assert_eq!(Fill::parse("CREATE OR REPLACE VIEW v AS SELECT 1"), None);
    }
}
