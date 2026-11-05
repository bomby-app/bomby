//! Whether each installed agent is set up: its provider, model and sign-in, as the voice
//! agent's probe finds them over ACP (`agent/probe.py`,
//! docs/decisions/check-agent-setup-with-an-acp-probe.md), with the user's picks applied
//! (`agent_picks.rs`), and, for the model picker, what can be picked
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
// ts-rs ignores serde's split rename_all, so it's told the page's names itself.
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "agents.ts", rename_all = "camelCase")
)]
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
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "agents.ts"))]
pub struct Skipped {
    pub setting: String,
    /// The setting's name, as the agent gives it: "Model".
    pub name: String,
    pub value: String,
    pub why: Why,
}

/// Why a pick didn't apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "agents.ts"))]
pub enum Why {
    /// The agent no longer offers it: a model removed or renamed.
    Gone,
    /// The agent offers it but wouldn't take it: a provider with no key, say.
    Refused,
}

/// What the model picker shows: an agent's setup, and the settings it lets the user pick
/// with the picks applied.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "agents.ts"))]
pub struct Listed {
    #[serde(flatten)]
    pub setup: Setup,
    #[serde(default)]
    pub settings: Vec<Setting>,
}

/// A session setting the user can pick: a model, an effort, goose's provider.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "agents.ts"))]
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
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "agents.ts"))]
pub struct SettingOption {
    pub value: String,
    pub name: String,
    /// The heading the agent files it under, if it groups its options.
    pub group: Option<String>,
}

/// The value the user picked for one setting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "agents.ts"))]
pub struct Pick {
    pub setting: String,
    pub value: String,
}

/// Probes `agents` (id and program), all at once, each with its `picks` applied.
/// `listing` is the agent whose settings the model picker lists; the others come back with
/// none. `None` when the probe couldn't run.
pub fn probe(
    agents: &[(String, PathBuf)],
    picks: &HashMap<String, Vec<Pick>>,
    listing: Option<&str>,
) -> Option<HashMap<String, Listed>> {
    if agents.is_empty() {
        return Some(HashMap::new());
    }
    let programs: HashMap<_, _> = agents.iter().map(|(id, path)| (id, path)).collect();
    let metadata = serde_json::json!({
        "agents": programs,
        "picks": picks,
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

    /// The probe's answer with every field set, as its own test pins it
    /// (agent/tests/test_probe_contract.py).
    const ANSWER: &str = include_str!("../../../agent/tests/fixtures/probe-answer.json");

    /// `needs_pick` as the page gets it: `needsPick`.
    fn camel(key: &str) -> String {
        let mut parts = key.split('_');
        let first = parts.next().unwrap_or_default().to_owned();
        parts.fold(first, |name, part| {
            let mut chars = part.chars();
            let upper = chars.next().map(|c| c.to_ascii_uppercase());
            name + &upper.into_iter().chain(chars).collect::<String>()
        })
    }

    fn keys(value: &serde_json::Value) -> Vec<String> {
        let mut keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        keys
    }

    #[test]
    fn reads_the_probes_answer() {
        let listed: HashMap<String, Listed> = serde_json::from_str(ANSWER).unwrap();
        let goose = &listed["goose"];
        assert_eq!(goose.setup.model.as_deref(), Some("Kimi K3.1 Pro"));
        assert_eq!(goose.setup.skipped[0].why, Why::Refused);
        assert!(goose.setup.needs_pick && goose.setup.session);
        assert_eq!(goose.settings[0].options[0].group.as_deref(), Some("Kimi"));

        // Every field the probe sends is read, and nothing the page gets is missing.
        let sent: serde_json::Value = serde_json::from_str(ANSWER).unwrap();
        let mut from_probe: Vec<_> = keys(&sent["goose"]).iter().map(|k| camel(k)).collect();
        from_probe.sort();
        assert_eq!(from_probe, keys(&serde_json::to_value(goose).unwrap()));
    }
}
