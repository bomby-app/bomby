//! Whether each installed agent is set up: its provider, model and sign-in, as the voice
//! agent's probe finds them over ACP (`agent/probe.py`,
//! docs/decisions/check-agent-setup-with-an-acp-probe.md), and the session settings the
//! setup flow offers (`agent/acp_client/settings.py`). Harnesses are defined there, so
//! nothing here knows any agent.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::agent;
use crate::agents::run;

/// Starting every agent and opening a session takes seconds; `uv run` can add a sync, and
/// the packaged agent's first start after an install takes about 30 s.
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
    /// What the setup flow offers, with the saved choices applied; empty without a session.
    #[serde(default)]
    pub settings: Vec<Setting>,
}

/// A session setting the setup flow offers: a model, an effort, goose's provider.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub id: String,
    pub name: String,
    /// ACP's category: `model`, `thought_level`, or none.
    pub category: Option<String>,
    pub current: String,
    pub options: Vec<SettingOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingOption {
    pub value: String,
    pub name: String,
    /// The heading the agent files it under, if it groups its options.
    pub group: Option<String>,
}

/// The value the user picked for one setting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Choice {
    pub setting: String,
    pub value: String,
}

/// Probes `agents` (id and program), all at once, each with its saved `choices` applied.
/// `setting_up` is the agent the user is setting up, which gets a session even when it
/// can't delete it. `None` when the probe couldn't run.
pub fn probe(
    agents: &[(String, PathBuf)],
    choices: &HashMap<String, Vec<Choice>>,
    setting_up: Option<&str>,
) -> Option<HashMap<String, Setup>> {
    if agents.is_empty() {
        return Some(HashMap::new());
    }
    let programs: HashMap<_, _> = agents.iter().map(|(id, path)| (id, path)).collect();
    let metadata = serde_json::json!({
        "agents": programs,
        "choices": choices,
        "setting_up": setting_up.into_iter().collect::<Vec<_>>(),
    })
    .to_string();
    let command = agent::command(&["probe", &metadata]).ok()?;
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
        let out = r#"{"goose": {"ready": false, "problem": "No provider", "fix": "goose configure", "account": null, "model": null, "adapter": null, "settings": [{"id": "provider", "name": "Provider", "category": null, "current": "openrouter", "options": [{"value": "openrouter", "name": "OpenRouter", "group": null}]}]}}"#;
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
                settings: vec![Setting {
                    id: "provider".into(),
                    name: "Provider".into(),
                    category: None,
                    current: "openrouter".into(),
                    options: vec![SettingOption {
                        value: "openrouter".into(),
                        name: "OpenRouter".into(),
                        group: None,
                    }],
                }],
            }
        );
    }
}
