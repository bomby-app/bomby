//! Whether each installed agent is set up: its provider, model and sign-in, as the voice
//! agent's probe finds them over ACP (`agent/probe.py`,
//! docs/decisions/check-agent-setup-with-an-acp-probe.md). Harnesses are defined there, so
//! nothing here knows any agent. Results are kept in the database with the program and
//! version they were about, so a launch only probes what changed.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::agent;
use crate::agents::run;
use crate::error::Result;

/// Starting every agent and opening a session takes seconds; `uv run` can add a sync.
const TIMEOUT: Duration = Duration::from_secs(60);
const KEY: &str = "agent_setups";

/// What the probe found for one agent (`Setup` in `agent/acp_client/probe.py`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub ready: bool,
    /// What's wrong, in the agent's words where it gave any.
    pub problem: Option<String>,
    /// What to run in Terminal to fix it.
    pub fix: Option<String>,
    /// Who it runs as: "Claude Max".
    pub account: Option<String>,
    pub model: Option<String>,
}

/// A probe's answer and the program it was about.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Checked {
    pub path: String,
    pub version: Option<String>,
    pub setup: Setup,
}

/// Probes `agents` (id and program), all at once. `None` when the probe couldn't run: a
/// release build without the agent yet, or a failure.
pub fn probe(agents: &[(String, PathBuf)]) -> Option<HashMap<String, Setup>> {
    let programs: HashMap<_, _> = agents.iter().map(|(id, path)| (id, path)).collect();
    let metadata = serde_json::json!({ "agents": programs }).to_string();
    let command = agent::command(&["probe.py", &metadata]).ok()?;
    let output = run(command, TIMEOUT)?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

/// What earlier probes found, by agent id.
pub fn load(conn: &Connection) -> HashMap<String, Checked> {
    let saved: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [KEY], |row| {
            row.get(0)
        })
        .optional()
        .ok()
        .flatten();
    saved
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

pub fn save(conn: &Connection, checked: &HashMap<String, Checked>) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![KEY, serde_json::to_string(checked)?],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn reads_the_probes_answer() {
        let out = r#"{"goose": {"ready": false, "problem": "No provider", "fix": "goose configure", "account": null, "model": null}}"#;
        let setups: HashMap<String, Setup> = serde_json::from_str(out).unwrap();
        assert_eq!(
            setups["goose"],
            Setup {
                ready: false,
                problem: Some("No provider".into()),
                fix: Some("goose configure".into()),
                account: None,
                model: None,
            }
        );
    }

    #[test]
    fn keeps_results_across_launches() {
        let db = Db::in_memory().unwrap();
        assert!(load(&db.conn()).is_empty());

        let checked = HashMap::from([(
            "omp".to_owned(),
            Checked {
                path: "/Users/me/.local/bin/omp".into(),
                version: Some("18.16.0".into()),
                setup: Setup {
                    ready: true,
                    problem: None,
                    fix: None,
                    account: None,
                    model: Some("K3.1 Pro".into()),
                },
            },
        )]);
        save(&db.conn(), &checked).unwrap();
        assert_eq!(load(&db.conn()), checked);
    }
}
