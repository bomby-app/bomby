//! The agents Bomby can hand work to, found on the user's computer
//! (docs/decisions/detect-acp-native-agents.md). The app never ships or signs in to them;
//! it finds the user's own install and tells the voice agent where it is.
//!
//! Adding one is a row in `KNOWN` here and a harness definition in `agent/harnesses/`,
//! under the same id.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::Result;

/// Long enough for a login shell with a heavy rc file, short enough not to hang Settings.
const TIMEOUT: Duration = Duration::from_secs(8);

/// One agent Bomby knows how to find.
struct Known {
    /// The harness id the voice agent uses (`agent/harnesses/`).
    id: &'static str,
    name: &'static str,
    /// Its command-line program.
    binary: &'static str,
    /// Where installers put it, relative to the home folder or absolute, for when the
    /// login shell can't tell us.
    places: &'static [&'static str],
    /// How to tell whether it is signed in, if it can say.
    sign_in: Option<fn(&Path) -> SignIn>,
}

const KNOWN: &[Known] = &[
    Known {
        id: "claude",
        name: "Claude Code",
        binary: "claude",
        places: &[
            "~/.local/bin/claude",
            "~/.claude/local/claude",
            "/opt/homebrew/bin/claude",
            "/usr/local/bin/claude",
        ],
        sign_in: Some(claude_sign_in),
    },
    Known {
        id: "opencode",
        name: "OpenCode",
        binary: "opencode",
        places: &[
            "~/.opencode/bin/opencode",
            "/opt/homebrew/bin/opencode",
            "/usr/local/bin/opencode",
        ],
        sign_in: None,
    },
    Known {
        id: "omp",
        name: "omp",
        binary: "omp",
        places: &[
            "~/.local/bin/omp",
            "/opt/homebrew/bin/omp",
            "/usr/local/bin/omp",
        ],
        sign_in: None,
    },
    Known {
        id: "goose",
        name: "goose",
        binary: "goose",
        places: &[
            "~/.local/bin/goose",
            "/opt/homebrew/bin/goose",
            "/usr/local/bin/goose",
        ],
        sign_in: None,
    },
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignIn {
    signed_in: bool,
    /// What to run in Terminal to sign in.
    login: &'static str,
    /// The account's plan, e.g. "max" or "pro".
    plan: Option<String>,
}

/// What Settings shows for one agent.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    id: &'static str,
    name: &'static str,
    /// Where its program is, or `None` when it isn't installed (or can't be found).
    path: Option<String>,
    version: Option<String>,
    /// `None` when the agent can't report it.
    sign_in: Option<SignIn>,
}

/// Runs `command` and returns its output if it finishes in time; kills it otherwise.
fn run(mut command: Command) -> Option<Output> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if started.elapsed() < TIMEOUT => thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

fn stdout(output: &Output) -> Option<String> {
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// Every known program as the user's login shell sees it, in one shell run. An app opened
/// from Finder doesn't get the user's shell PATH, so a plain lookup would miss most.
fn shell_paths() -> HashMap<String, PathBuf> {
    let Ok(shell) = std::env::var("SHELL") else {
        return HashMap::new();
    };
    let script: String = KNOWN
        .iter()
        .map(|k| format!("printf '{0}=%s\\n' \"$(command -v {0})\";", k.binary))
        .collect();
    let mut lookup = Command::new(shell);
    lookup.args(["-ilc", &script]);
    // An interactive rc file may print its own lines; ours are `binary=path`.
    run(lookup)
        .as_ref()
        .and_then(stdout)
        .map(|out| parse_shell_paths(&out))
        .unwrap_or_default()
}

fn parse_shell_paths(out: &str) -> HashMap<String, PathBuf> {
    out.lines()
        .filter_map(|line| line.split_once('='))
        .filter(|(binary, _)| KNOWN.iter().any(|k| k.binary == *binary))
        .map(|(binary, path)| (binary.to_owned(), PathBuf::from(path)))
        .filter(|(_, path)| path.is_absolute() && path.is_file())
        .collect()
}

fn expand(place: &str, home: Option<&Path>) -> Option<PathBuf> {
    match place.strip_prefix("~/") {
        Some(rest) => home.map(|h| h.join(rest)),
        None => Some(PathBuf::from(place)),
    }
}

/// Finds each known agent the way a terminal would, then in its usual install places.
fn find_all() -> Vec<(&'static Known, Option<PathBuf>)> {
    let from_shell = shell_paths();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    KNOWN
        .iter()
        .map(|known| {
            let path = from_shell.get(known.binary).cloned().or_else(|| {
                known
                    .places
                    .iter()
                    .filter_map(|p| expand(p, home.as_deref()))
                    .find(|p| p.is_file())
            });
            (known, path)
        })
        .collect()
}

/// `claude auth status --json`, the fields we read.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeAuth {
    logged_in: bool,
    subscription_type: Option<String>,
}

fn claude_sign_in(claude: &Path) -> SignIn {
    let mut auth = Command::new(claude);
    auth.args(["auth", "status", "--json"]);
    let auth: Option<ClaudeAuth> = run(auth)
        .as_ref()
        .and_then(stdout)
        .and_then(|json| serde_json::from_str(&json).ok());
    SignIn {
        signed_in: auth.as_ref().is_some_and(|a| a.logged_in),
        login: "claude auth login",
        plan: auth.and_then(|a| a.subscription_type),
    }
}

fn status_of(known: &'static Known, path: Option<PathBuf>) -> AgentStatus {
    let Some(path) = path else {
        return AgentStatus {
            id: known.id,
            name: known.name,
            path: None,
            version: None,
            sign_in: None,
        };
    };
    let mut version = Command::new(&path);
    version.arg("--version");
    AgentStatus {
        id: known.id,
        name: known.name,
        version: run(version).as_ref().and_then(stdout),
        sign_in: known.sign_in.map(|check| check(&path)),
        path: Some(path.display().to_string()),
    }
}

/// The agents found when the last call opened, by id, for that call's token. Opening a
/// call looks again, so an agent installed since is picked up.
#[derive(Default)]
pub struct Found(Mutex<Vec<(String, PathBuf)>>);

impl Found {
    /// Looks for every known agent and remembers the ones that are installed.
    pub fn refresh(&self) -> Vec<(String, PathBuf)> {
        let found: Vec<_> = find_all()
            .into_iter()
            .filter_map(|(known, path)| path.map(|p| (known.id.to_owned(), p)))
            .collect();
        *self.0.lock().unwrap_or_else(|p| p.into_inner()) = found.clone();
        found
    }

    pub fn get(&self) -> Vec<(String, PathBuf)> {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
}

/// Every known agent: installed or not, its version, and its sign-in where it reports one.
/// Runs the user's own programs, which only read their local state.
#[tauri::command(async)]
pub fn agents_status() -> Result<Vec<AgentStatus>> {
    Ok(find_all()
        .into_iter()
        .map(|(known, path)| status_of(known, path))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_known_programs_from_the_shell_and_skips_noise() {
        let me = std::env::current_exe().unwrap();
        let out = format!(
            "Welcome back!\nclaude={}\nopencode=\nomp=relative/omp\nls=/bin/ls\n",
            me.display()
        );
        let paths = parse_shell_paths(&out);
        assert_eq!(paths.get("claude"), Some(&me));
        assert_eq!(paths.len(), 1);
    }

    #[test]
    fn expands_home_relative_places() {
        let home = Path::new("/Users/me");
        assert_eq!(
            expand("~/.local/bin/omp", Some(home)),
            Some(PathBuf::from("/Users/me/.local/bin/omp"))
        );
        assert_eq!(
            expand("/opt/homebrew/bin/omp", Some(home)),
            Some(PathBuf::from("/opt/homebrew/bin/omp"))
        );
        assert_eq!(expand("~/x", None), None);
    }
}
