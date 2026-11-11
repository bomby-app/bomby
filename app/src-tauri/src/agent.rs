//! The voice agent worker (`agent/`): one process for the app's lifetime, registered with
//! the user's LiveKit project under the name `bomby`, so each call's token can dispatch
//! it. The core starts it on the first call, restarts it when the keys change or it died,
//! and stops it when the app quits.
//!
//! Its keys go in its environment, never on disk. Its output goes to `agent.log` in the
//! app's log folder. It holds a pipe from us on its stdin and exits when that closes, so it
//! never outlives the app, even when the app is killed (`agent/lifeline.py`).
//!
//! Debug builds run the agent from source with uv (`just app dev`). Release builds run the
//! packaged agent, frozen by `just agent freeze` and shipped in the app's resources
//! (docs/decisions/ship-the-agent-and-adapter-as-sidecars.md). Both run the same entry,
//! `agent/bundle.py`.

use std::collections::{BTreeMap, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::credentials::{AGENT_KEYS_ENV, AgentKeys, LiveKitKeys, agent_keys_env};
use crate::error::{Error, Result};
use crate::process;
use crate::sync;
use crate::voice::VoiceProvider;

/// The worker's log in the app's log folder, rewritten per start.
pub const LOG_FILE: &str = "agent.log";
/// How long a fresh worker gets to register with LiveKit.
const READY_TIMEOUT: Duration = Duration::from_secs(60);
/// How long the worker gets to exit after SIGTERM before SIGKILL.
const STOP_TIMEOUT: Duration = Duration::from_secs(5);
/// What livekit-agents logs once the worker is registered (`worker.py`, `_handle_register`).
const READY_LINE: &str = "registered worker";
/// How many of the worker's last lines to keep for a failure message.
const RECENT_LINES: usize = 50;
/// What livekit-agents logs when a job's entrypoint raises (1.8.10,
/// `ipc/job_proc_lazy_main.py`, `_on_entry_done`), with the job's `room` and `exc_info`. In
/// `start` mode the JSON line's `message` is this, a newline, then the traceback.
const CRASH_LINE: &str = "unhandled exception while running the job task";
/// What the voice agent logs when a coding agent wasn't ready on a call
/// (`NOT_READY_LINE` in `agent/acp_client/runner.py`), with the agent's id in `not_ready`.
const NOT_READY_LINE: &str = "coding agent not ready";

/// A call's job that crashed: its room, and why, in one line.
#[derive(Debug, PartialEq, Eq)]
pub struct JobCrash {
    pub room: String,
    pub reason: String,
}

/// What the worker's output tells the core.
#[derive(Debug, PartialEq, Eq)]
pub enum WorkerNews {
    /// A call's job crashed.
    Crashed(JobCrash),
    /// A coding agent, by id, wasn't ready on a call.
    NotReady(String),
}

/// Told the news in the worker's output, in order, on a thread apart from the ones reading
/// it, so it may take locks and wait.
pub type OnNews = Arc<dyn Fn(WorkerNews) + Send + Sync>;

/// Everything the worker needs to run. A change to any of it means a restart.
#[derive(PartialEq, Eq)]
pub struct WorkerConfig {
    pub livekit: LiveKitKeys,
    /// Every voice provider's key that's saved, so picking another provider doesn't
    /// restart the worker; each call's metadata names the one it talks through.
    pub voice_keys: BTreeMap<VoiceProvider, String>,
    /// Whenever one is saved; each call's metadata says whether it remembers.
    pub zep_key: Option<String>,
    /// Every coding agent's saved keys; the voice agent hands each agent only its own.
    pub agent_keys: AgentKeys,
    /// Where the hosted MCP extensions' tokens come from (`extensions::tokens`): the
    /// socket's path and the run's secret, the same for the whole run.
    pub tokens: Option<[(&'static str, String); 2]>,
    /// Where the Agents panel's live streams go (`agent_streams`): the socket's path and the
    /// run's secret, the same for the whole run.
    pub streams: Option<[(&'static str, String); 2]>,
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
    /// Makes sure a worker with `config` is running and registered. A worker started here
    /// tells `on_news` what its output reports.
    pub fn ensure(&self, config: WorkerConfig, log_dir: &Path, on_news: OnNews) -> Result<()> {
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
        let (child, lifeline) = start(&config, log_dir, on_news)?;
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

/// The command that runs the agent with `args`: `start` (the worker) or `probe` and its
/// metadata (setup checks), as `agent/bundle.py` reads them.
pub fn command(args: &[&str]) -> Result<Command> {
    let mut command = if cfg!(debug_assertions) {
        // The repo's agent/, next to app/.
        let agent_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../agent");
        let mut command = Command::new("uv");
        command
            .args(["run", "python", "bundle.py"])
            .current_dir(agent_dir);
        command
    } else {
        packaged()?
    };
    command.args(args);
    // The adapters the app installed (adapters.rs), not the repo's.
    if let Some(adapters) = crate::adapters::bin_dir() {
        command.env("BOMBY_ADAPTERS", adapters);
    }
    Ok(command)
}

/// The packaged agent: `bundle.macOS.files` in tauri.conf.json puts its folder in
/// `Contents/Resources/agent`, next to `Contents/MacOS`, which holds this program. That's
/// the folder Tauri's `resource_dir` names, found here without an `AppHandle`.
fn packaged() -> Result<Command> {
    let exe = std::env::current_exe()?;
    let dir = exe
        .parent()
        .and_then(Path::parent)
        .map(|contents| contents.join("Resources").join("agent"));
    let program = dir.as_ref().map(|dir| dir.join("bomby-agent"));
    match (dir, program) {
        (Some(dir), Some(program)) if program.is_file() => {
            let mut command = Command::new(program);
            // Its own folder, as from source, never wherever Bomby was opened from.
            command.current_dir(dir);
            Ok(command)
        }
        _ => Err(Error::Invalid(
            "This copy of Bomby is missing its voice agent. Install Bomby again.".into(),
        )),
    }
}

fn start(config: &WorkerConfig, log_dir: &Path, on_news: OnNews) -> Result<(Child, ChildStdin)> {
    std::fs::create_dir_all(log_dir)?;
    let log = Arc::new(Mutex::new(File::create(log_dir.join(LOG_FILE))?));

    let mut command = command(&["start"])?;
    command
        .env("LIVEKIT_URL", &config.livekit.url)
        .env("LIVEKIT_API_KEY", &config.livekit.api_key)
        .env("LIVEKIT_API_SECRET", &config.livekit.api_secret)
        // Exit when this app does, however it ends (`agent/lifeline.py`).
        .env("BOMBY_EXIT_WITH_APP", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for provider in VoiceProvider::ALL {
        match config.voice_keys.get(&provider) {
            Some(key) => command.env(provider.key_env(), key),
            None => command.env_remove(provider.key_env()),
        };
    }
    match &config.zep_key {
        Some(key) => command.env("ZEP_API_KEY", key),
        None => command.env_remove("ZEP_API_KEY"),
    };
    match agent_keys_env(&config.agent_keys) {
        Some(keys) => command.env(AGENT_KEYS_ENV, keys),
        None => command.env_remove(AGENT_KEYS_ENV),
    };
    for (name, value) in config.tokens.iter().chain(&config.streams).flatten() {
        command.env(name, value);
    }
    // Its own process group, so stopping it also stops uv's python and the job processes.
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);

    let mut child = command.spawn()?;
    let lifeline = child
        .stdin
        .take()
        .ok_or_else(|| Error::Invalid("The agent's stdin isn't piped".into()))?;
    let (ready_tx, ready_rx) = mpsc::channel();
    // The readers only read: what the output reports is acted on here, on a thread of its
    // own, so a reader never waits on what acting takes (the database, say) and the worker
    // never blocks writing to a pipe nobody drains. It ends once both readers have.
    let (news_tx, news_rx) = mpsc::channel::<WorkerNews>();
    thread::spawn(move || {
        for news in news_rx {
            on_news(news);
        }
    });
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
        let news_tx = news_tx.clone();
        thread::spawn(move || {
            for line in BufReader::new(stream)
                .lines()
                .map_while(std::io::Result::ok)
            {
                if line.contains(READY_LINE) {
                    let _ = ready_tx.send(());
                }
                if let Some(news) = news(&line) {
                    let _ = news_tx.send(news);
                }
                if let Ok(mut file) = log.lock() {
                    let _ = writeln!(file, "{line}");
                }
                remember(&recent, line);
            }
        });
    }
    drop((ready_tx, news_tx));

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
                log_dir.join(LOG_FILE).display()
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
        error_text(&entry)
    })
}

/// What `line` tells the core, if anything: a crashed job, or a coding agent not ready.
fn news(line: &str) -> Option<WorkerNews> {
    job_crash(line)
        .map(WorkerNews::Crashed)
        .or_else(|| not_ready(line).map(WorkerNews::NotReady))
}

/// The coding agent `line` says wasn't ready on a call, if it says so.
fn not_ready(line: &str) -> Option<String> {
    let entry: serde_json::Value = serde_json::from_str(line).ok()?;
    if entry.get("message")?.as_str()? != NOT_READY_LINE {
        return None;
    }
    Some(entry.get("not_ready")?.as_str()?.to_owned())
}

/// The crash `line` reports, if it's livekit-agents saying a job crashed. The reason drops
/// the exception's type: "project folder does not exist: ...", not "ValueError: ...".
fn job_crash(line: &str) -> Option<JobCrash> {
    let entry: serde_json::Value = serde_json::from_str(line).ok()?;
    // The message is the line, then the traceback.
    if !entry.get("message")?.as_str()?.starts_with(CRASH_LINE) {
        return None;
    }
    let text = error_text(&entry)?;
    let reason = match text.split_once(": ") {
        Some((kind, rest)) if !kind.is_empty() && !kind.contains(' ') => rest.to_owned(),
        _ => text,
    };
    Some(JobCrash {
        room: entry.get("room")?.as_str()?.to_owned(),
        reason,
    })
}

/// An error entry in one line: its traceback's last line, or its message.
fn error_text(entry: &serde_json::Value) -> Option<String> {
    let text = entry
        .get("exc_info")
        .and_then(|e| e.as_str())
        .or_else(|| entry.get("message")?.as_str())?;
    text.lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_owned())
}

/// Asks the worker's process group to stop, then makes sure it has.
fn stop(child: Child) {
    process::stop_group(child, STOP_TIMEOUT);
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::{JobCrash, RECENT_LINES, WorkerNews, job_crash, last_error, news, remember};

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

    #[test]
    fn reads_a_crashed_jobs_room_and_reason() {
        // As livekit-agents 1.8.10 logs it (agent.log, 2026-11-05), trimmed.
        let line = r#"{"message": "unhandled exception while running the job task\nTraceback (most recent call last):\n  File \"agent.py\"\nValueError: project folder does not exist: /Users/me/gone", "level": "ERROR", "name": "livekit.agents", "exc_info": "Traceback (most recent call last):\n  File \"agent.py\"\nValueError: project folder does not exist: /Users/me/gone", "job_id": "AJ_x", "room": "bomby-4-1793832334892"}"#;
        assert_eq!(
            job_crash(line),
            Some(JobCrash {
                room: "bomby-4-1793832334892".into(),
                reason: "project folder does not exist: /Users/me/gone".into(),
            })
        );
        assert!(matches!(news(line), Some(WorkerNews::Crashed(_))));
        let other = r#"{"message": "worker failed", "level": "ERROR", "room": "bomby-4-1"}"#;
        assert_eq!(job_crash(other), None);
        assert_eq!(job_crash("not json"), None);
    }

    #[test]
    fn reads_which_coding_agent_wasnt_ready_on_a_call() {
        // As `report_not_ready` in agent/acp_client/runner.py logs it, trimmed.
        let line = r#"{"level": "WARNING", "name": "bomby.acp_client.runner", "message": "coding agent not ready", "not_ready": "goose", "room": "bomby-4-1"}"#;
        assert_eq!(news(line), Some(WorkerNews::NotReady("goose".into())));
        let other =
            r#"{"level": "WARNING", "message": "goose could not start", "room": "bomby-4-1"}"#;
        assert_eq!(news(other), None);
        assert_eq!(
            news("coding agent not ready"),
            None,
            "only the worker's JSON lines"
        );
    }
}
