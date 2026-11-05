//! Whether each installed agent is set up: its provider, model and sign-in, as the voice
//! agent's probe finds them over ACP (`agent/probe.py`,
//! docs/decisions/check-agent-setup-with-an-acp-probe.md), with the user's picks applied
//! (`agent_choices.rs`), and, for the model picker, what can be picked
//! (`agent/acp_client/settings.py`). Harnesses are defined there, so nothing here knows any
//! agent.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::agent;
use crate::agents::run;

/// Starting every agent and opening a session takes seconds; `uv run` can add a sync, and
/// the packaged agent's first start after an install takes about 30 s.
const TIMEOUT: Duration = Duration::from_secs(60);

/// What the probe found for one agent (`Setup` in `agent/acp_client/probe.py`). The probe
/// writes snake_case, the page reads camelCase.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
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
    /// Picks that didn't apply (gone or refused); sessions keep its default for them.
    #[serde(default)]
    pub skipped: Vec<Skipped>,
    /// Its harness requires a model pick (`model_selection_required`) and none holds.
    #[serde(default)]
    pub needs_pick: bool,
    /// Whether the probe opened a session, so `model` and `skipped` are known.
    #[serde(default)]
    pub session: bool,
}

/// A pick that didn't apply, so the session keeps the agent's default for it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Skipped {
    pub setting: String,
    /// The setting's name, as the agent gives it: "Model".
    pub name: String,
    pub value: String,
    /// `gone` (no longer offered) or `refused` (offered, but the agent wouldn't take it).
    pub why: String,
}

/// What the model picker shows: an agent's setup, and the settings it lets the user pick
/// with the picks applied.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Listed {
    #[serde(flatten)]
    pub setup: Setup,
    #[serde(default)]
    pub settings: Vec<Setting>,
}

/// A session setting the user can pick: a model, an effort, goose's provider.
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

/// Probes `agents` (id and program), all at once, each with its `choices` applied.
/// `listing` is the agent whose settings the model picker lists; the others come back with
/// none. `None` when the probe couldn't run.
pub fn probe(
    agents: &[(String, PathBuf)],
    choices: &HashMap<String, Vec<Choice>>,
    listing: Option<&str>,
) -> Option<HashMap<String, Listed>> {
    if agents.is_empty() {
        return Some(HashMap::new());
    }
    let programs: HashMap<_, _> = agents.iter().map(|(id, path)| (id, path)).collect();
    let metadata = serde_json::json!({
        "agents": programs,
        "choices": choices,
        "listing": listing.into_iter().collect::<Vec<_>>(),
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
        let out = r#"{"goose": {"ready": false, "problem": "No provider", "fix": "goose configure", "account": null, "model": null, "adapter": null, "skipped": [{"setting": "model", "name": "Model", "value": "x", "why": "gone"}], "needs_pick": true, "session": true, "settings": [{"id": "provider", "name": "Provider", "category": null, "current": "openrouter", "options": [{"value": "openrouter", "name": "OpenRouter", "group": null}]}]}}"#;
        let listed: HashMap<String, Listed> = serde_json::from_str(out).unwrap();
        let goose = &listed["goose"];
        assert_eq!(
            goose.setup,
            Setup {
                ready: false,
                problem: Some("No provider".into()),
                fix: Some("goose configure".into()),
                skipped: vec![Skipped {
                    setting: "model".into(),
                    name: "Model".into(),
                    value: "x".into(),
                    why: "gone".into(),
                }],
                needs_pick: true,
                session: true,
                ..Setup::default()
            }
        );
        assert_eq!(goose.settings[0].options[0].name, "OpenRouter");
        // The page gets camelCase.
        let sent = serde_json::to_value(goose).unwrap();
        assert_eq!(sent["needsPick"], true);
        assert_eq!(sent["settings"][0]["id"], "provider");
    }
}
