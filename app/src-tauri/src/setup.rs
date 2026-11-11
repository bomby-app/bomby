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
use crate::credentials::{AGENT_KEYS_ENV, AgentKeys, agent_keys_env};

/// Starting every agent and opening a session takes seconds; `uv run` can add a sync, and
/// the packaged agent's first start after an install takes about 30 s.
const TIMEOUT: Duration = Duration::from_secs(60);

/// What the probe found for one agent (`Setup` in `agent/acp_client/probe.py`). The probe
/// writes snake_case, the page reads camelCase.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
// Only tests build one from nothing: anywhere else that would claim an agent is ready.
#[cfg_attr(test, derive(Default))]
// ts-rs ignores serde's split rename_all, so it's told the page's names itself.
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "agents.ts", rename_all = "camelCase")
)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct Setup {
    pub step: Step,
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
    /// Whether the probe opened a session, so `model` and `skipped` are known.
    #[serde(default)]
    pub session: bool,
    /// The keys Settings offers to save for it, which reach only this agent
    /// (docs/decisions/agent-keys-through-the-environment.md).
    #[serde(default)]
    pub keys: Vec<KeyField>,
    /// The files that hold its own setup: a ready check is remembered until one changes
    /// (`agent_checks`). None for an agent that's checked at every launch.
    #[serde(default)]
    pub setup_files: Vec<String>,
    /// It didn't answer in time (`Unreachable`): for an agent that reads its keys from the
    /// macOS keychain, most likely a password prompt nobody has answered yet.
    #[serde(default)]
    pub timed_out: bool,
}

impl Setup {
    /// Keeps `before`'s key fields, those the agent's row showed, when this answer has none
    /// and opened no session: without one the probe can't always tell which keys the agent
    /// takes (goose's follow its provider), and a failure is exactly when the user needs a
    /// field to save one in.
    pub fn keep_keys_from(&mut self, before: &Setup) {
        if !self.session && self.keys.is_empty() {
            self.keys.clone_from(&before.keys);
        }
    }
}

/// A key the agent asks for, saved under the environment variable `name` (`KeyField` in
/// `agent/acp_client/probe.py`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "agents.ts", rename_all = "camelCase")
)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct KeyField {
    /// The environment variable: "OPENROUTER_API_KEY".
    pub name: String,
    /// What the field is called: "OpenRouter API key".
    pub label: String,
    /// A secret, typed in a password field.
    pub secret: bool,
    pub optional: bool,
}

/// What an agent needs before a call can use it, as the probe decides it (`Step` in
/// `agent/acp_client/probe.py`); the page and the looks read it, rather than guessing from
/// the other fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(Default))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "agents.ts"))]
pub enum Step {
    /// Its ACP adapter, which Set up installs.
    Connect,
    /// Something in its own setup (a sign-in, a model): the user fixes it in the agent.
    SignIn,
    /// A model pick its harness requires (`model_selection_required`).
    Pick,
    /// It didn't answer: it timed out, quit or couldn't start.
    Unreachable,
    /// Nothing: calls can use it.
    #[cfg_attr(test, default)]
    Ready,
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
// Named apart from TypeScript's own `Pick<T, K>`, which it would shadow.
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "agents.ts", rename = "SettingPick")
)]
pub struct Pick {
    pub setting: String,
    pub value: String,
}

/// Probes `agents` (id and program), all at once, each with its `picks` applied and the
/// `keys` the user saved for it in its environment (never on the command line).
/// `listing` is the agent whose settings the model picker lists; the others come back with
/// none. `sessions` are those it opens a session in even if they can't delete it, so their
/// setup and model are checked, not assumed (once per launch, `agents.rs`). `None` when the
/// probe couldn't run.
pub fn probe(
    agents: &[(String, PathBuf)],
    picks: &HashMap<String, Vec<Pick>>,
    listing: Option<&str>,
    sessions: &[String],
    keys: &AgentKeys,
) -> Option<HashMap<String, Listed>> {
    if agents.is_empty() {
        return Some(HashMap::new());
    }
    let programs: HashMap<_, _> = agents.iter().map(|(id, path)| (id, path)).collect();
    let metadata = serde_json::json!({
        "agents": programs,
        "picks": picks,
        "listing": listing.into_iter().collect::<Vec<_>>(),
        "sessions": sessions,
    })
    .to_string();
    let mut command = agent::command(&["probe", &metadata]).ok()?;
    match agent_keys_env(keys) {
        Some(keys) => command.env(AGENT_KEYS_ENV, keys),
        None => command.env_remove(AGENT_KEYS_ENV),
    };
    let output = run(command, TIMEOUT)?;
    if !output.status.success() {
        return None;
    }
    read_answer(&output.stdout)
}

/// The probe's answer, agent by agent, so one the core can't read (a step it doesn't know
/// yet) costs only that agent its setup, which then counts as not probed.
fn read_answer(stdout: &[u8]) -> Option<HashMap<String, Listed>> {
    let answers: HashMap<String, serde_json::Value> = serde_json::from_slice(stdout).ok()?;
    Some(
        answers
            .into_iter()
            .filter_map(|(id, answer)| Some((id, serde_json::from_value(answer).ok()?)))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    /// The probe's answer with every field set, as its own test pins it
    /// (agent/tests/test_probe_contract.py).
    const ANSWER: &str = include_str!("../../../agent/tests/fixtures/probe-answer.json");

    /// `last_seen` as the page gets it: `lastSeen`.
    fn camel(key: &str) -> String {
        let mut parts = key.split('_');
        let first = parts.next().unwrap_or_default().to_owned();
        parts.fold(first, |name, part| {
            let mut chars = part.chars();
            let upper = chars.next().map(|c| c.to_ascii_uppercase());
            name + &upper.into_iter().chain(chars).collect::<String>()
        })
    }

    /// Every key in `value` by its path, nested ones too (an array by its first item),
    /// each named by `name`.
    fn paths(value: &Value, name: fn(&str) -> String) -> Vec<String> {
        fn walk(value: &Value, at: &str, name: fn(&str) -> String, found: &mut Vec<String>) {
            match value {
                Value::Object(fields) => {
                    for (key, field) in fields {
                        let path = format!("{at}.{}", name(key));
                        walk(field, &path, name, found);
                        found.push(path);
                    }
                }
                Value::Array(items) => {
                    if let Some(first) = items.first() {
                        walk(first, &format!("{at}[]"), name, found);
                    }
                }
                _ => {}
            }
        }
        let mut found = Vec::new();
        walk(value, "", name, &mut found);
        found.sort();
        found
    }

    #[test]
    fn an_answer_it_cant_read_costs_only_that_agent() {
        let answer = format!(r#"{{"goose": {}, "omp": {{"step": "someday"}}}}"#, {
            let all: Value = serde_json::from_str(ANSWER).unwrap();
            all["goose"].to_string()
        });
        let listed = read_answer(answer.as_bytes()).unwrap();
        assert!(listed.contains_key("goose"));
        assert!(!listed.contains_key("omp"));
    }

    #[test]
    fn reads_the_probes_answer() {
        let listed: HashMap<String, Listed> = serde_json::from_str(ANSWER).unwrap();
        let goose = &listed["goose"];
        assert_eq!(goose.setup.step, Step::Pick);
        assert_eq!(goose.setup.model.as_deref(), Some("Kimi K3.1 Pro"));
        assert_eq!(goose.setup.skipped[0].why, Why::Refused);
        assert!(goose.setup.session);
        assert_eq!(goose.setup.keys[0].name, "OPENROUTER_API_KEY");
        assert_eq!(
            goose.setup.setup_files,
            ["/Users/me/.config/goose/config.yaml"]
        );
        assert_eq!(goose.settings[0].options[0].group.as_deref(), Some("Kimi"));

        // Every key the probe sends, at every level, reaches the page.
        let sent: Value = serde_json::from_str(ANSWER).unwrap();
        let read = serde_json::to_value(&listed).unwrap();
        assert_eq!(paths(&sent, camel), paths(&read, str::to_owned));
    }
}
