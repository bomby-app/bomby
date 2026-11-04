//! Whether each installed agent is set up: its provider, model and sign-in, as the voice
//! agent's probe finds them over ACP (`agent/probe.py`,
//! docs/decisions/check-agent-setup-with-an-acp-probe.md). Harnesses are defined there, so
//! nothing here knows any agent.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::agent;
use crate::agents::run;

/// Starting every agent and opening a session takes seconds; `uv run` can add a sync.
const TIMEOUT: Duration = Duration::from_secs(60);

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
    /// The ACP adapter it needs and doesn't have yet (`adapters.rs` installs it).
    pub adapter: Option<String>,
}

/// Probes `agents` (id and program), all at once. `None` when the probe couldn't run: a
/// release build without the agent yet, or a failure.
pub fn probe(agents: &[(String, PathBuf)]) -> Option<HashMap<String, Setup>> {
    if agents.is_empty() {
        return Some(HashMap::new());
    }
    let programs: HashMap<_, _> = agents.iter().map(|(id, path)| (id, path)).collect();
    let metadata = serde_json::json!({ "agents": programs }).to_string();
    let command = agent::command(&["probe.py", &metadata]).ok()?;
    let output = run(command, TIMEOUT)?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_probes_answer() {
        let out = r#"{"goose": {"ready": false, "problem": "No provider", "fix": "goose configure", "account": null, "model": null, "adapter": null}}"#;
        let setups: HashMap<String, Setup> = serde_json::from_str(out).unwrap();
        assert_eq!(
            setups["goose"],
            Setup {
                ready: false,
                problem: Some("No provider".into()),
                fix: Some("goose configure".into()),
                account: None,
                model: None,
                adapter: None,
            }
        );
    }
}
