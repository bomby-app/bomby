//! The user's own Claude Code (docs/decisions/users-bring-their-own-keys-and-claude.md):
//! where its `claude` is, its version, and whether it is signed in. The app never ships or
//! signs in to Claude itself; the adapter later runs this same binary
//! (`CLAUDE_CODE_EXECUTABLE`).

use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::Result;

/// Long enough for a login shell with a heavy rc file, short enough not to hang Settings.
const TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    /// Where `claude` is, or `None` when it isn't installed (or can't be found).
    path: Option<String>,
    version: Option<String>,
    signed_in: bool,
    /// The plan of the signed-in account, e.g. "max" or "pro".
    plan: Option<String>,
}

/// `claude auth status --json`, the fields we read.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthStatus {
    logged_in: bool,
    subscription_type: Option<String>,
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

/// Finds `claude` the way a terminal would. An app opened from Finder doesn't get the
/// user's shell PATH, so ask their login shell first, then try the usual install places.
pub fn find() -> Option<PathBuf> {
    if let Ok(shell) = std::env::var("SHELL") {
        let mut lookup = Command::new(shell);
        lookup.args(["-ilc", "command -v claude"]);
        // An interactive rc file may print its own lines; the path is the last one.
        let found = run(lookup)
            .as_ref()
            .and_then(stdout)
            .and_then(|out| out.lines().last().map(PathBuf::from));
        if let Some(path) = found.filter(|p| p.is_absolute() && p.is_file()) {
            return Some(path);
        }
    }
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    [
        home.join(".local/bin/claude"),
        home.join(".claude/local/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

fn status_of(claude: &Path) -> ClaudeStatus {
    let mut version = Command::new(claude);
    version.arg("--version");
    let version = run(version).as_ref().and_then(stdout);

    let mut auth = Command::new(claude);
    auth.args(["auth", "status", "--json"]);
    let auth: Option<AuthStatus> = run(auth)
        .as_ref()
        .and_then(stdout)
        .and_then(|json| serde_json::from_str(&json).ok());

    ClaudeStatus {
        path: Some(claude.display().to_string()),
        version,
        signed_in: auth.as_ref().is_some_and(|a| a.logged_in),
        plan: auth.and_then(|a| a.subscription_type),
    }
}

/// Whether Claude Code is installed and signed in. Runs the user's `claude`, which only
/// reads its local state.
#[tauri::command(async)]
pub fn claude_status() -> Result<ClaudeStatus> {
    Ok(match find() {
        Some(claude) => status_of(&claude),
        None => ClaudeStatus {
            path: None,
            version: None,
            signed_in: false,
            plan: None,
        },
    })
}
