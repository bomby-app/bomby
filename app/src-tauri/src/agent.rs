//! The voice agent worker (`agent/`): one process for the app's lifetime, registered with
//! the user's LiveKit project under the name `bomby`, so each call's token can dispatch
//! it. The core starts it on the first call, restarts it when the keys change or it died,
//! and stops it when the app quits.
//!
//! Its keys go in its environment, never on disk. Its output goes to `agent.log` in the
//! app's log folder. It holds a pipe from us on its stdin and exits when that closes, so it
//! never outlives the app, even when the app is killed (`agent/lifeline.py`).
//!
//! Debug builds run the agent from source with uv (`just app dev`). Release builds will run
//! the packaged sidecar (docs/decisions/ship-the-agent-and-adapter-as-sidecars.md); until
//! then they report that there is no agent.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::credentials::LiveKitKeys;
use crate::error::{Error, Result};
use crate::process;
use crate::sync;

/// How long a fresh worker gets to register with LiveKit.
const READY_TIMEOUT: Duration = Duration::from_secs(60);
/// How long the worker gets to exit after SIGTERM before SIGKILL.
const STOP_TIMEOUT: Duration = Duration::from_secs(5);
/// What livekit-agents logs once the worker is registered (`worker.py`, `_handle_register`).
const READY_LINE: &str = "registered worker";
/// How many of the worker's last lines to keep for a failure message.
const RECENT_LINES: usize = 50;

/// Everything the worker needs to run. A change to any of it means a restart.
#[derive(PartialEq, Eq)]
pub struct WorkerConfig {
    pub livekit_url: String,
    pub livekit_api_key: String,
    pub livekit_api_secret: String,
    pub gemini_key: String,
}

impl WorkerConfig {
    pub fn new(keys: LiveKitKeys, gemini_key: String) -> Self {
        Self {
            livekit_url: keys.url,
            livekit_api_key: keys.api_key,
            livekit_api_secret: keys.api_secret,
            gemini_key,
        }
    }
}

struct Running {
    child: Child,
    /// Held open for the worker's life. When this process ends, the OS closes it and the
    /// worker exits on its own (`agent/lifeline.py`).
    _lifeline: ChildStdin,
    config: WorkerConfig,
}

/// The worker, shared through Tauri state.
#[derive(Default)]
pub struct AgentWorker(Mutex<Option<Running>>);

impl AgentWorker {
    /// Makes sure a worker with `config` is running and registered.
    pub fn ensure(&self, config: WorkerConfig, log_dir: &Path) -> Result<()> {
        let mut slot = sync::lock(&self.0);
        if let Some(running) = slot.as_mut() {
            let alive = matches!(running.child.try_wait(), Ok(None));
            if alive && running.config == config {
                return Ok(());
            }
        }
        if let Some(old) = slot.take() {
            stop(old.child);
        }
        let (child, lifeline) = start(&config, log_dir)?;
        *slot = Some(Running {
            child,
            _lifeline: lifeline,
            config,
        });
        Ok(())
    }

    /// Stops the worker, if one runs. Called when the app exits.
    pub fn shutdown(&self) {
        let mut slot = sync::lock(&self.0);
        if let Some(running) = slot.take() {
            stop(running.child);
        }
    }
}

/// The command that runs one of the agent's programs: `agent.py start` (the worker) or
/// `probe.py` (setup checks).
pub fn command(args: &[&str]) -> Result<Command> {
    if cfg!(debug_assertions) {
        // The repo's agent/, next to app/.
        let agent_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../agent");
        let mut command = Command::new("uv");
        command
            .args(["run", "python"])
            .args(args)
            .current_dir(agent_dir);
        // The adapters the app installed (adapters.rs), not the repo's.
        if let Some(adapters) = crate::adapters::bin_dir() {
            command.env("BOMBY_ADAPTERS", adapters);
        }
        Ok(command)
    } else {
        Err(Error::Invalid(
            "This build doesn't include the agent yet. Run Bomby with `just app dev`.".into(),
        ))
    }
}

fn start(config: &WorkerConfig, log_dir: &Path) -> Result<(Child, ChildStdin)> {
    std::fs::create_dir_all(log_dir)?;
    let log = Arc::new(Mutex::new(File::create(log_dir.join("agent.log"))?));

    let mut command = command(&["agent.py", "start"])?;
    command
        .env("LIVEKIT_URL", &config.livekit_url)
        .env("LIVEKIT_API_KEY", &config.livekit_api_key)
        .env("LIVEKIT_API_SECRET", &config.livekit_api_secret)
        .env("GOOGLE_API_KEY", &config.gemini_key)
        // Exit when this app does, however it ends (`agent/lifeline.py`).
        .env("BOMBY_EXIT_WITH_APP", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Its own process group, so stopping it also stops uv's python and the job processes.
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);

    let mut child = command.spawn()?;
    let lifeline = child
        .stdin
        .take()
        .ok_or_else(|| Error::Invalid("The agent's stdin isn't piped".into()))?;
    let (ready_tx, ready_rx) = mpsc::channel();
    // The last lines, to say why it failed without sending the user to the log.
    let recent = Arc::new(Mutex::new(VecDeque::with_capacity(RECENT_LINES)));
    for stream in [
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let (log, ready_tx, recent) = (Arc::clone(&log), ready_tx.clone(), Arc::clone(&recent));
        thread::spawn(move || {
            for line in BufReader::new(stream)
                .lines()
                .map_while(std::io::Result::ok)
            {
                if line.contains(READY_LINE) {
                    let _ = ready_tx.send(());
                }
                if let Ok(mut file) = log.lock() {
                    let _ = writeln!(file, "{line}");
                }
                remember(&recent, line);
            }
        });
    }
    drop(ready_tx);

    match ready_rx.recv_timeout(READY_TIMEOUT) {
        Ok(()) => Ok((child, lifeline)),
        Err(_) => {
            stop(child);
            let reason = recent
                .lock()
                .ok()
                .and_then(|recent| last_error(recent.iter().map(String::as_str)));
            Err(Error::Invalid(format!(
                "The agent didn't start{}. Its log is in {}.",
                reason.map(|r| format!(": {r}")).unwrap_or_default(),
                log_dir.join("agent.log").display()
            )))
        }
    }
}

/// Keeps `line` among the worker's last `RECENT_LINES` lines.
fn remember(recent: &Mutex<VecDeque<String>>, line: String) {
    if let Ok(mut recent) = recent.lock() {
        if recent.len() == RECENT_LINES {
            recent.pop_front();
        }
        recent.push_back(line);
    }
}

/// The last error the worker logged, in one line. livekit-agents logs JSON lines in `start`
/// mode; an exception's last traceback line says what went wrong.
fn last_error<'a>(lines: impl DoubleEndedIterator<Item = &'a str>) -> Option<String> {
    lines.rev().find_map(|line| {
        let entry: serde_json::Value = serde_json::from_str(line).ok()?;
        if entry.get("level")?.as_str()? != "ERROR" {
            return None;
        }
        let text = entry
            .get("exc_info")
            .and_then(|e| e.as_str())
            .or_else(|| entry.get("message")?.as_str())?;
        text.lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .map(|l| l.trim().to_owned())
    })
}

/// Asks the worker's process group to stop, then makes sure it has.
fn stop(mut child: Child) {
    #[cfg(unix)]
    if let Ok(pid) = i32::try_from(child.id()) {
        // SAFETY: killpg only sends a signal; the group is the one the child leads.
        unsafe { libc::killpg(pid, libc::SIGTERM) };
        if let Ok(Some(_)) = process::wait_timeout(&mut child, STOP_TIMEOUT) {
            return;
        }
        unsafe { libc::killpg(pid, libc::SIGKILL) };
    }
    process::kill(&mut child);
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::{RECENT_LINES, last_error, remember};

    #[test]
    fn keeps_only_the_last_lines() {
        let recent = Mutex::new(VecDeque::new());
        for n in 0..RECENT_LINES + 5 {
            remember(&recent, format!("line {n}"));
        }
        let recent = recent.into_inner().unwrap();
        assert_eq!(recent.len(), RECENT_LINES);
        assert_eq!(recent.front().map(String::as_str), Some("line 5"));
    }

    #[test]
    fn finds_the_last_logged_error() {
        let lines = [
            r#"{"message": "starting worker", "level": "INFO"}"#,
            r#"{"message": "worker failed", "level": "ERROR", "exc_info": "Traceback (most recent call last):\n  File x\nOSError: [Errno 48] address already in use"}"#,
            r#"{"message": "draining worker", "level": "INFO"}"#,
            "not json",
        ];
        assert_eq!(
            last_error(lines.into_iter()).as_deref(),
            Some("OSError: [Errno 48] address already in use")
        );
        assert_eq!(last_error(["plain text"].into_iter()), None);
    }
}
