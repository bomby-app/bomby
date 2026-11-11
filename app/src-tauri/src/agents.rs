//! The agents Bomby can hand work to, found on the user's computer
//! (docs/decisions/detect-acp-native-agents.md). The app never ships or signs in to them;
//! it finds the user's own install and tells the voice agent where it is.
//!
//! Adding one is a row in `KNOWN` here and a harness definition in `agent/harnesses/`,
//! under the same id. Whether it is set up comes from the harness, through the probe
//! ([`setup`](crate::setup)), which applies the model and effort the user picked, if any
//! ([`agent_picks`](crate::agent_picks)).
//!
//! Finding them runs the user's login shell and each agent's own program, which takes
//! seconds, so the core does it once at launch, in the background, and keeps the result in
//! [`Agents`]. Each look also probes the installed agents' setup, with the keys the user
//! saved for each in its environment, except an agent whose ready check is remembered and
//! still holds ([`agent_checks`](crate::agent_checks)). Settings shows what is kept and
//! looks again on Check again, which checks every agent; each call looks up the programs
//! again before it opens.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::agent_checks::{self, Fingerprint, Remembered};
use crate::agent_key_fields;
use crate::agent_picks;
use crate::credentials::{AgentKeys, Vault};
use crate::db::{Db, now_ms};
use crate::dev;
use crate::error::Result;
use crate::process;
use crate::setup::{self, KeyField, Listed, Pick, Setup, Step};
use crate::sync;

/// The event every window gets with the new list when a look finds something different.
pub const CHANGED: &str = "agents-changed";

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
    /// Its own page on installing it, which Install opens. Each is also allowed in the
    /// windows' `opener:allow-open-url` (`capabilities/`).
    install_page: &'static str,
    /// A command that shows whether it starts, for when it didn't.
    check: &'static str,
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
        install_page: "https://code.claude.com/docs/en/quickstart",
        check: "claude --version",
    },
    Known {
        id: "codex",
        name: "Codex",
        binary: "codex",
        places: &[
            "~/.local/bin/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex",
        ],
        install_page: "https://learn.chatgpt.com/docs/codex/cli",
        check: "codex doctor",
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
        install_page: "https://opencode.ai/docs/",
        check: "opencode --version",
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
        install_page: "https://omp.sh/docs/quickstart",
        check: "omp --version",
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
        install_page: "https://goose-docs.ai/docs/quickstart/",
        check: "goose --version",
    },
];

/// What Settings shows for one agent.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "agents.ts"))]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    id: &'static str,
    name: &'static str,
    /// Where its program is, or `None` when it isn't installed (or can't be found).
    path: Option<String>,
    version: Option<String>,
    /// `None` when the probe couldn't run.
    setup: Option<Setup>,
    /// Where to install it from (`Known::install_page`).
    install_page: &'static str,
    /// What shows whether it starts (`Known::check`); the sign-in comes from the probe.
    check: &'static str,
}

/// How long a timed-out program's group gets to exit after SIGTERM, before SIGKILL.
const STOP_GRACE: Duration = Duration::from_secs(2);

/// Runs `command` and returns its output if it finishes within `timeout`; kills it
/// otherwise.
///
/// Its output goes to a file, not a pipe: a pipe holds only 64 KiB, so a program writing more
/// waits for a reader, and a program it starts (a daemon from the shell's rc files) can hold
/// a pipe open after it exits, keeping any reader waiting. A file has neither problem, and
/// it's unlinked at once, so nothing is left behind.
///
/// It runs in a session of its own, which it leads, so its process group is its own too and
/// a timeout stops the whole group: a probe's coding agents and their adapters, or what a
/// login shell started, go with it. A session, not just a group: a new group in Bomby's own
/// session is a background job of the terminal Bomby was started from (`just app dev`), and
/// an interactive shell there is stopped the moment it reaches for that terminal, so the
/// lookup timed out and found nothing. A new session has no terminal, as when Bomby is opened
/// from Finder.
pub fn run(mut command: Command, timeout: Duration) -> Option<Output> {
    let mut out = unlinked_file().ok()?;
    command
        .stdin(Stdio::null())
        .stdout(out.try_clone().ok()?)
        .stderr(Stdio::null());
    #[cfg(unix)]
    // SAFETY: the closure runs in the child between fork and exec, and calls only setsid,
    // which is async-signal-safe and touches nothing of this process.
    unsafe {
        std::os::unix::process::CommandExt::pre_exec(&mut command, || {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = command.spawn().ok()?;
    let Ok(Some(status)) = process::wait_timeout(&mut child, timeout) else {
        process::stop_group(child, STOP_GRACE);
        return None;
    };
    let mut stdout = Vec::new();
    out.seek(SeekFrom::Start(0)).ok()?;
    out.read_to_end(&mut stdout).ok()?;
    Some(Output {
        status,
        stdout,
        stderr: Vec::new(),
    })
}

/// A new file in the temp folder, removed from it at once: it lives as long as an open
/// handle to it (macOS and Linux).
fn unlinked_file() -> std::io::Result<File> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let name = format!(
        "bomby-run-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    );
    let path = std::env::temp_dir().join(name);
    let file = File::options()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path)?;
    fs::remove_file(&path)?;
    Ok(file)
}

fn stdout(output: &Output) -> Option<String> {
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// Every known program as the user's login shell sees it, in one shell run. An app opened
/// from Finder doesn't get the user's shell PATH, so a plain lookup would miss most. `None`
/// when the shell couldn't answer (no `$SHELL`, an error, or the timeout).
fn shell_paths() -> Option<HashMap<String, PathBuf>> {
    let shell = std::env::var("SHELL").ok()?;
    let script: String = KNOWN
        .iter()
        .map(|k| format!("printf '{0}=%s\\n' \"$(command -v {0})\";", k.binary))
        .collect();
    let mut lookup = Command::new(shell);
    lookup.args(["-ilc", &script]);
    // An interactive rc file may print its own lines; ours are `binary=path`.
    run(lookup, TIMEOUT)
        .as_ref()
        .and_then(stdout)
        .map(|out| parse_shell_paths(&out))
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

/// Finds each known agent the way a terminal would, then in its usual install places. In
/// development, `just app dev --agents` can hide some, as if not installed ([`dev`]).
fn find_all(previous: &HashMap<String, PathBuf>) -> Vec<(&'static Known, Option<PathBuf>)> {
    // No login shell when no agent may be found (`--agents=none`, the smoke check).
    let from_shell = KNOWN
        .iter()
        .any(|known| dev::agent_shown(known.id))
        .then(shell_paths)
        .flatten();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    KNOWN
        .iter()
        .map(|known| {
            let path = dev::agent_shown(known.id)
                .then(|| pick_path(known, from_shell.as_ref(), previous, home.as_deref()))
                .flatten();
            (known, path)
        })
        .collect()
}

/// Where `known` is: what the shell says, else its usual install places. When the shell
/// couldn't answer, a program found before that is still there wins, so a slow shell never
/// makes an installed agent look gone.
fn pick_path(
    known: &Known,
    from_shell: Option<&HashMap<String, PathBuf>>,
    previous: &HashMap<String, PathBuf>,
    home: Option<&Path>,
) -> Option<PathBuf> {
    match from_shell {
        Some(found) => found.get(known.binary).cloned(),
        None => previous.get(known.id).filter(|p| p.is_file()).cloned(),
    }
    .or_else(|| {
        known
            .places
            .iter()
            .filter_map(|p| expand(p, home))
            .find(|p| p.is_file())
    })
}

fn status_of(known: &'static Known, path: Option<PathBuf>) -> AgentStatus {
    AgentStatus {
        id: known.id,
        name: known.name,
        version: path.as_deref().and_then(version_of),
        path: path.map(|p| p.display().to_string()),
        setup: None,
        install_page: known.install_page,
        check: known.check,
    }
}

/// What `program --version` prints, if it answers in time.
fn version_of(program: &Path) -> Option<String> {
    let mut command = Command::new(program);
    command.arg("--version");
    run(command, TIMEOUT).as_ref().and_then(stdout)
}

/// What a look takes from elsewhere, read once it has started: each agent's picks and saved
/// keys, the checks remembered from before, and the key fields each row last offered from a
/// session (`agent_key_fields`).
#[derive(Default)]
pub struct Look {
    pub picks: HashMap<String, Vec<Pick>>,
    pub keys: AgentKeys,
    pub remembered: HashMap<String, Remembered>,
    pub key_fields: HashMap<String, Vec<KeyField>>,
    /// When the look started, and what was known of each agent then.
    pub started: Started,
}

/// When a check started, and the revision of what was known of each agent then
/// ([`Agents::revision`]): what its answer may be recorded against.
#[derive(Debug, Clone, Default)]
pub struct Started {
    /// In ns since 1970, as file modification times are compared.
    pub at: u128,
    pub revisions: HashMap<String, u64>,
    /// How often each agent's picks had changed ([`Agents::picked`]).
    pub picks: HashMap<String, u64>,
}

impl Started {
    fn revision(&self, id: &str) -> u64 {
        self.revisions.get(id).copied().unwrap_or_default()
    }
}

impl Look {
    /// What a check of agent `id`, run from `program` and set up in `files`, depends on now.
    fn fingerprint(&self, id: &str, program: &Path, files: &[String]) -> Fingerprint {
        let keys: Vec<String> = self
            .keys
            .get(id)
            .map(|vars| vars.keys().cloned().collect())
            .unwrap_or_default();
        let picks = self.picks.get(id).map(Vec::as_slice).unwrap_or_default();
        Fingerprint::of(program, files, picks, &keys)
    }

    /// What agent `id`'s row shows for `setup`, the probe's answer: with the key fields a
    /// session last offered, kept from an earlier launch, when it can't name any
    /// ([`Setup::keep_keys`]).
    fn shown(&self, id: &str, mut setup: Setup) -> Setup {
        if let Some(kept) = self.key_fields.get(id) {
            setup.keep_keys(kept);
        }
        setup
    }

    /// The remembered setup of agent `id` at `program`, if it still holds at `at`.
    fn still_holds(&self, id: &str, program: &Path, at: i64) -> Option<Setup> {
        let remembered = self.remembered.get(id)?;
        let now = self.fingerprint(id, program, remembered.files());
        remembered.holds(&now, at).then(|| remembered.setup.clone())
    }
}

/// Every known agent with its status and setup, the probe applying each one's picks and
/// keys from `look`. An agent whose remembered check still holds isn't started; every check
/// the probe makes goes to `record`, with what it depends on and what it lets the user pick.
/// One that fails without naming its keys offers the fields a session last named
/// ([`Setup::keep_keys`]), from an earlier launch too. The probe and each agent's own checks
/// run side by side, so a look takes about as long as the shell and the slowest of them.
fn detect_all(
    previous: &HashMap<String, PathBuf>,
    look: &Look,
    checked: &HashSet<String>,
    record: &(dyn Fn(&str, &Listed, &Fingerprint, &Started) + Sync),
) -> Vec<AgentStatus> {
    let found = find_all(previous);
    let now = now_ms();
    let (mut reused, mut probed) = (HashMap::new(), Vec::new());
    for (id, program) in programs(found.clone()) {
        match look.still_holds(&id, &program, now) {
            Some(setup) => {
                reused.insert(id, setup);
            }
            None => probed.push((id, program)),
        }
    }
    // Once per launch, a session even in one that can't delete it (omp): checked, not assumed.
    let sessions: Vec<String> = probed
        .iter()
        .map(|(id, _)| id.clone())
        .filter(|id| !checked.contains(id))
        .collect();
    thread::scope(|scope| {
        let probe = scope.spawn(|| {
            let setups =
                setup::probe(&probed, &look.picks, None, &sessions, &look.keys).unwrap_or_default();
            for (id, program) in &probed {
                if let Some(listed) = setups.get(id) {
                    let files = &listed.setup.setup_files;
                    let fingerprint = look.fingerprint(id, program, files);
                    record(id, listed, &fingerprint, &look.started);
                }
            }
            setups
        });
        let checks: Vec<_> = found
            .into_iter()
            .map(|(known, path)| (known, scope.spawn(move || status_of(known, path))))
            .collect();
        let mut agents: Vec<_> = checks
            .into_iter()
            .map(|(known, check)| check.join().unwrap_or_else(|_| status_of(known, None)))
            .collect();
        let mut setups = probe.join().unwrap_or_default();
        for agent in &mut agents {
            agent.setup = reused
                .remove(agent.id)
                .or_else(|| Some(look.shown(agent.id, setups.remove(agent.id)?.setup)));
        }
        agents
    })
}

/// The name the user knows agent `id` by: "Claude Code".
pub fn name(id: &str) -> Option<&'static str> {
    KNOWN.iter().find(|k| k.id == id).map(|k| k.name)
}

/// The installed ones among `agents`, by id with their programs: what a call hands the voice
/// agent.
pub fn installed(agents: &[AgentStatus]) -> Vec<(String, PathBuf)> {
    agents
        .iter()
        .filter_map(|a| Some((a.id.to_owned(), PathBuf::from(a.path.as_ref()?))))
        .collect()
}

/// The agents on this computer as last found, shared by Settings and calls. One look runs at
/// a time: whoever asks while one runs waits for it instead of starting another.
#[derive(Default)]
pub struct Agents {
    state: Mutex<Detection>,
    finished: Condvar,
    /// One pick or picker listing per agent at a time (`agent_picks`), by agent id.
    picking: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

#[derive(Default)]
struct Detection {
    /// `None` until the first look finishes.
    found: Option<Vec<AgentStatus>>,
    running: bool,
    /// Callers waiting for the running look.
    waiting: usize,
    /// Counts finished looks, so a waiter can tell its look is done.
    looks: u64,
    /// Programs a call found that the next look starts from, so a login shell that fails
    /// then doesn't lose them.
    seen: HashMap<String, PathBuf>,
    /// How often each agent's picks changed, so a look that started before a pick doesn't
    /// put back what that agent ran on before it.
    picks: HashMap<String, u64>,
    /// The agents a session has checked this launch (a look, the model picker or a pick):
    /// later looks open none in one that can't delete it, and keep what it found.
    checked: HashSet<String>,
    /// Agents a call found not ready, to check again once it ends.
    unready_on_call: HashSet<String>,
    /// How often what's known of each agent changed under a running check (its keys, or a
    /// call that found it not ready), so a check that started before isn't recorded.
    revisions: HashMap<String, u64>,
}

impl Detection {
    fn replace_setup(&mut self, id: &str, setup: &Setup) -> Option<Vec<AgentStatus>> {
        if setup.session {
            self.checked.insert(id.to_owned());
        }
        let found = self.found.as_mut()?;
        let agent = found.iter_mut().find(|a| a.id == id)?;
        let mut setup = setup.clone();
        if let Some(before) = &agent.setup {
            setup.keep_keys(&before.keys);
        }
        if agent.setup.as_ref() == Some(&setup) {
            return None;
        }
        agent.setup = Some(setup);
        Some(found.clone())
    }
}

impl Agents {
    fn lock(&self) -> MutexGuard<'_, Detection> {
        sync::lock(&self.state)
    }

    /// The lock that keeps agent `id` to one pick or listing at a time, so two windows can't
    /// leave its saved picks and its row apart. Each takes a probe of seconds; other agents'
    /// don't wait on it.
    pub fn one_at_a_time(&self, id: &str) -> Arc<Mutex<()>> {
        Arc::clone(sync::lock(&self.picking).entry(id.to_owned()).or_default())
    }

    /// Has the next look check every agent with a session again, omp too (a full check).
    pub fn forget_checks(&self) {
        self.lock().checked.clear();
    }

    /// Agent `id` wasn't ready on a call: it's checked again once the call ends.
    pub fn unready_on_call(&self, id: &str) {
        self.lock().unready_on_call.insert(id.to_owned());
    }

    /// When a check starts now, and what it may be recorded against.
    pub fn start_check(&self) -> Started {
        let state = self.lock();
        Started {
            at: agent_checks::now_ns(),
            revisions: state.revisions.clone(),
            picks: state.picks.clone(),
        }
    }

    /// Whether agent `id`'s picks are as they were when a check `started`, so what it found
    /// can be picked still holds.
    pub fn unpicked(&self, started: &Started, id: &str) -> bool {
        self.lock().picks.get(id) == started.picks.get(id)
    }

    /// Records a check of `id` that `started`, unless what was known of `id` changed since
    /// (its keys, a call). Under the database's lock (`conn`), which [`Agents::invalidate`]
    /// takes too, so the two never interleave.
    pub fn record_check(
        &self,
        conn: &Connection,
        id: &str,
        setup: &Setup,
        fingerprint: &Fingerprint,
        started: &Started,
    ) -> Result<()> {
        if !self.unrevised(started, id) {
            return Ok(());
        }
        agent_checks::record(conn, id, setup, fingerprint, started.at)
    }

    /// Forgets `id`'s remembered check, and keeps any check of it already running from
    /// recording its answer. Under the database's lock (`conn`), as [`Agents::record_check`].
    pub fn invalidate(&self, conn: &Connection, id: &str) -> Result<()> {
        self.revise(id);
        agent_checks::forget(conn, id)
    }

    /// Whether what's known of `id` is as it was when a check `started`: its answer may be
    /// kept and shown.
    pub fn unrevised(&self, started: &Started, id: &str) -> bool {
        self.lock().revisions.get(id).copied().unwrap_or_default() == started.revision(id)
    }

    /// What's known of `id` changed: no check that started before is recorded, or shown.
    fn revise(&self, id: &str) {
        *self.lock().revisions.entry(id.to_owned()).or_default() += 1;
    }

    /// Adds `keys`, which agent `id` asked for when a pick was refused (a provider without
    /// its key), to its row's key fields, so the user can save one and pick again. The new
    /// list when that changed the row.
    pub fn offer_keys(&self, id: &str, keys: &[setup::KeyField]) -> Option<Vec<AgentStatus>> {
        let mut state = self.lock();
        let found = state.found.as_mut()?;
        let setup = found.iter_mut().find(|a| a.id == id)?.setup.as_mut()?;
        let before = setup.keys.len();
        for key in keys {
            if !setup.keys.iter().any(|k| k.name == key.name) {
                setup.keys.push(key.clone());
            }
        }
        (setup.keys.len() != before).then(|| found.clone())
    }

    /// Whether a call found an agent not ready since this was last asked.
    fn take_unready_on_call(&self) -> bool {
        let unready = std::mem::take(&mut self.lock().unready_on_call);
        !unready.is_empty()
    }

    /// Agents as if a look had found agent `id` at `path` with `setup`, for other modules'
    /// tests.
    #[cfg(test)]
    pub(crate) fn showing(id: &'static str, path: &str, setup: Setup) -> Self {
        let agents = Self::default();
        agents.detect_with(None, |_| {
            vec![AgentStatus {
                id,
                name: id,
                path: Some(path.to_owned()),
                version: None,
                setup: Some(setup.clone()),
                install_page: "https://example.com/install",
                check: "nowhere --version",
            }]
        });
        agents
    }

    /// The key variables agent `id`'s row offers, for tests.
    #[cfg(test)]
    pub(crate) fn offered_keys(&self, id: &str) -> Vec<String> {
        self.cached()
            .unwrap_or_default()
            .into_iter()
            .filter(|a| a.id == id)
            .filter_map(|a| a.setup)
            .flat_map(|s| s.keys.into_iter().map(|k| k.name))
            .collect()
    }

    /// Whether the agent `id`, as last found, asks for a key in the variable `name`.
    pub(crate) fn offers_key(&self, id: &str, name: &str) -> bool {
        self.lock()
            .found
            .iter()
            .flatten()
            .filter(|a| a.id == id)
            .filter_map(|a| a.setup.as_ref())
            .any(|setup| setup.keys.iter().any(|key| key.name == name))
    }

    /// What the last look found, if one has finished.
    pub fn cached(&self) -> Option<Vec<AgentStatus>> {
        self.lock().found.clone()
    }

    /// Puts `setup`, which the model picker just found for agent `id`, in place of its
    /// setup, and returns the new list when that changed it; `None` when it didn't, or no
    /// look has found that agent.
    pub fn replace_setup(&self, id: &str, setup: &Setup) -> Option<Vec<AgentStatus>> {
        self.lock().replace_setup(id, setup)
    }

    /// [`Agents::replace_setup`] right after the user picked agent `id`'s settings: a look
    /// that started before the pick keeps this setup over its own.
    pub fn picked(&self, id: &str, setup: &Setup) -> Option<Vec<AgentStatus>> {
        let mut state = self.lock();
        *state.picks.entry(id.to_owned()).or_default() += 1;
        state.replace_setup(id, setup)
    }

    /// Looks again, or waits for the look already running, and returns what it found and
    /// whether that differs from before. Blocks for as long as the look takes.
    ///
    /// With `seen`, the programs a call just found, the answer comes from a look that starts
    /// after this one asked, and that look starts from them: a look already running began
    /// before they were found, so it may miss them.
    ///
    /// `look` reads the user's picks and keys and the remembered checks. It's called once
    /// the look has started, so a pick saved before it is in the look, and one saved after
    /// it is kept over the look's answer. `record` keeps each check the probe makes.
    pub fn detect(
        &self,
        seen: Option<Vec<(String, PathBuf)>>,
        look: impl FnOnce() -> Look,
        record: &(dyn Fn(&str, &Listed, &Fingerprint, &Started) + Sync),
    ) -> (Vec<AgentStatus>, bool) {
        let checked = self.lock().checked.clone();
        self.detect_with(seen, |previous| {
            detect_all(previous, &look(), &checked, record)
        })
    }

    fn detect_with(
        &self,
        seen: Option<Vec<(String, PathBuf)>>,
        look: impl FnOnce(&HashMap<String, PathBuf>) -> Vec<AgentStatus>,
    ) -> (Vec<AgentStatus>, bool) {
        let mut state = self.lock();
        // The number of the look that answers: the running one, or the next for news, and
        // this caller's own when none runs. Only one runs at a time, so they finish in order.
        let answer = state.looks + 1 + u64::from(seen.is_some() && state.running);
        state.seen.extend(seen.into_iter().flatten());
        while state.running {
            state.waiting += 1;
            state = self
                .finished
                .wait_while(state, |s| s.running)
                .unwrap_or_else(PoisonError::into_inner);
            state.waiting -= 1;
            if state.looks >= answer {
                // The look's own caller tells the windows about a change.
                return (state.found.clone().unwrap_or_default(), false);
            }
        }
        state.running = true;
        let mut previous: HashMap<_, _> = state
            .found
            .as_deref()
            .map(installed)
            .unwrap_or_default()
            .into_iter()
            .collect();
        let seen = std::mem::take(&mut state.seen);
        previous.extend(seen.clone());
        let picks = state.picks.clone();
        let revisions = state.revisions.clone();
        drop(state);

        // A look that panics keeps what was found before, and never leaves waiters waiting.
        let found = panic::catch_unwind(AssertUnwindSafe(|| look(&previous)));

        let mut state = self.lock();
        let changed = match found {
            Ok(found) => {
                let picked_since = |id: &str| state.picks.get(id) != picks.get(id);
                let revised_since = |id: &str| state.revisions.get(id) != revisions.get(id);
                let found = keep_what_the_look_missed(
                    found,
                    state.found.as_deref(),
                    picked_since,
                    revised_since,
                );
                for agent in &found {
                    if agent.setup.as_ref().is_some_and(|s| s.session) {
                        state.checked.insert(agent.id.to_owned());
                    }
                }
                let changed = state.found.as_ref() != Some(&found);
                state.found = Some(found);
                changed
            }
            Err(_) => {
                // The next look starts from them instead, unless a newer call found others.
                for (id, path) in seen {
                    state.seen.entry(id).or_insert(path);
                }
                false
            }
        };
        state.running = false;
        state.looks += 1;
        self.finished.notify_all();
        (state.found.clone().unwrap_or_default(), changed)
    }
}

/// `found`, a look's answer, with what it couldn't know taken from `before`, the list it
/// replaces: the setup of an agent whose settings were picked while it ran, for an agent it
/// opened no session in (omp can't delete one), the setup last found with a session, by a
/// look, the model picker or a pick, and for one that failed without naming its keys, the
/// key fields its row showed ([`Setup::keep_keys`]). An agent `revised_since` the look
/// started (its keys changed, [`Agents::invalidate`]) keeps its row whatever the look found,
/// failures too: the look ran on what's no longer true, and the agent's own recheck answers.
fn keep_what_the_look_missed(
    mut found: Vec<AgentStatus>,
    before: Option<&[AgentStatus]>,
    picked_since: impl Fn(&str) -> bool,
    revised_since: impl Fn(&str) -> bool,
) -> Vec<AgentStatus> {
    for agent in &mut found {
        let Some(old) = before
            .unwrap_or_default()
            .iter()
            .find(|a| a.id == agent.id)
            .and_then(|a| a.setup.as_ref())
        else {
            continue;
        };
        if revised_since(agent.id) {
            agent.setup = Some(old.clone());
            continue;
        }
        if let Some(setup) = agent.setup.as_mut() {
            setup.keep_keys(&old.keys);
        }
        // A problem with the agent itself (signed out, not answering) shows: no pick changes it.
        if agent
            .setup
            .as_ref()
            .is_some_and(|s| !matches!(s.step, Step::Ready | Step::Pick))
        {
            continue;
        }
        let sessionless = !agent.setup.as_ref().is_some_and(|s| s.session);
        // Without a session a look knows only the sign-in: the last session's answer stands.
        if picked_since(agent.id) || (sessionless && old.session) {
            agent.setup = Some(old.clone());
        }
    }
    found
}

/// Whether Bomby knows an agent by this id.
pub(crate) fn is_known(id: &str) -> bool {
    KNOWN.iter().any(|known| known.id == id)
}

/// The installed ones among `agents` a call can use: all but those the probe found not set
/// up. One not probed yet stays, so a probe that can't run never hides an agent.
pub fn usable(agents: &[AgentStatus]) -> Vec<(String, PathBuf)> {
    let ready: Vec<_> = agents
        .iter()
        .filter(|a| a.setup.as_ref().is_none_or(|s| s.step == Step::Ready))
        .cloned()
        .collect();
    installed(&ready)
}

/// The agents a call can use, looked up now: the shell and the install places only, without
/// the version checks, which a call doesn't need, minus those Settings shows as not set up
/// at the same program. Blocks for the shell lookup. When the programs differ from what
/// Settings shows, a full look starting from them follows in the background, so Settings
/// catches up.
pub fn usable_now<R: Runtime>(app: &AppHandle<R>) -> Vec<(String, PathBuf)> {
    let shown = app.state::<Agents>().cached().unwrap_or_default();
    let shown_installed = installed(&shown);
    let previous: HashMap<_, _> = shown_installed.iter().cloned().collect();
    let found = programs(find_all(&previous));
    if shown_installed != found {
        let (app, seen) = (app.clone(), found.clone());
        tauri::async_runtime::spawn_blocking(move || refresh(&app, Some(seen)));
    }
    without_unready(found, &shown)
}

/// `found` minus the programs `shown` has as not set up.
fn without_unready(found: Vec<(String, PathBuf)>, shown: &[AgentStatus]) -> Vec<(String, PathBuf)> {
    let set_up = usable(shown);
    let unready: Vec<_> = installed(shown)
        .into_iter()
        .filter(|program| !set_up.contains(program))
        .collect();
    found
        .into_iter()
        .filter(|program| !unready.contains(program))
        .collect()
}

/// The ones `find_all` found, by id with their programs, in `KNOWN` order like
/// [`installed`].
fn programs(found: Vec<(&'static Known, Option<PathBuf>)>) -> Vec<(String, PathBuf)> {
    found
        .into_iter()
        .filter_map(|(known, path)| Some((known.id.to_owned(), path?)))
        .collect()
}

/// Looks for the agents (blocking), starting from what a call has `seen`, and tells every
/// window when they changed.
fn refresh<R: Runtime>(
    app: &AppHandle<R>,
    seen: Option<Vec<(String, PathBuf)>>,
) -> Vec<AgentStatus> {
    let record = |id: &str, listed: &Listed, fingerprint: &Fingerprint, started: &Started| {
        record_key_fields(app, id, &listed.setup, started);
        record_check(app, id, &listed.setup, fingerprint, started);
        agent_picks::keep_listing(app, id, listed, started);
    };
    let (found, changed) = app
        .state::<Agents>()
        .detect(seen, || look_reads(app), &record);
    if changed {
        // Only fails for an invalid event name or payload; a window that misses it still
        // gets the list when it asks.
        let _ = app.emit(CHANGED, &found);
    }
    found
}

/// What a look reads before it starts: the user's picks, the remembered checks and the kept
/// key fields, in one hold of the database, and the agents' saved keys. Without the database
/// (only if it can't be read), every agent shows its defaults and is checked.
pub(crate) fn look_reads<R: Runtime>(app: &AppHandle<R>) -> Look {
    // Before anything it reads: what changes after this is the next check's.
    let started = app.state::<Agents>().start_check();
    let SavedChoices {
        picks,
        remembered,
        key_fields,
    } = saved_choices(&app.state::<Db>()).unwrap_or_else(|e| {
        let _ = crate::app_log::append(app, &format!("reading the agents' picks: {e}"));
        SavedChoices::default()
    });
    Look {
        started,
        picks,
        keys: saved_keys(app),
        remembered,
        key_fields,
    }
}

#[derive(Default)]
struct SavedChoices {
    picks: HashMap<String, Vec<Pick>>,
    remembered: HashMap<String, Remembered>,
    key_fields: HashMap<String, Vec<KeyField>>,
}

/// Every agent's picks, remembered check and kept key fields.
fn saved_choices(db: &Db) -> Result<SavedChoices> {
    let conn = db.conn()?;
    Ok(SavedChoices {
        picks: agent_picks::saved(&conn)?,
        remembered: agent_checks::all(&conn)?,
        key_fields: agent_key_fields::all(&conn)?,
    })
}

/// Keeps the key fields a session of `id` offered, for its row at later launches
/// (`agent_key_fields`), unless its picks or what's known of it changed since the check
/// `started`: the answer is about a setup that's no longer the agent's. Logged when it can't.
pub(crate) fn record_key_fields<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    setup: &Setup,
    started: &Started,
) {
    let agents = app.state::<Agents>();
    if !setup.session || !agents.unrevised(started, id) || !agents.unpicked(started, id) {
        return;
    }
    let recorded = app
        .state::<Db>()
        .conn()
        .and_then(|conn| agent_key_fields::record(&conn, id, setup));
    if let Err(e) = recorded {
        let _ = crate::app_log::append(app, &format!("keeping {id}'s key fields: {e}"));
    }
}

/// Keeps a check a look made ([`Agents::record_check`]); logged when it can't.
pub(crate) fn record_check<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    setup: &Setup,
    fingerprint: &Fingerprint,
    started: &Started,
) {
    // Checked without the agents' keys: not what a launch with them would find.
    if app.state::<Vault>().unreadable() {
        return;
    }
    let recorded = app.state::<Db>().conn().and_then(|conn| {
        app.state::<Agents>()
            .record_check(&conn, id, setup, fingerprint, started)
    });
    if let Err(e) = recorded {
        let _ = crate::app_log::append(app, &format!("remembering {id}'s check: {e}"));
    }
}

/// [`refresh`] after something on disk changed (adapters installed), for callers already on
/// a blocking thread. The answer comes from a look that starts now: one already running
/// began before the change, so it may miss it (an empty `seen` asks for that, as a call's
/// news does).
pub fn refresh_after_change<R: Runtime>(app: &AppHandle<R>) {
    refresh(app, Some(Vec::new()));
}

/// Every coding agent's saved keys. None when the keychain can't be read: the agents then
/// find their own, as before any was saved.
pub fn saved_keys<R: Runtime>(app: &AppHandle<R>) -> AgentKeys {
    app.state::<Vault>().agent_keys(app).unwrap_or_else(|e| {
        let _ = crate::app_log::append(app, &format!("reading the agents' keys: {e}"));
        AgentKeys::default()
    })
}

/// Whether agent `id` asks for a key in the variable `name`, as its row last showed.
pub fn offers_key<R: Runtime>(app: &AppHandle<R>, id: &str, name: &str) -> bool {
    app.state::<Agents>().offers_key(id, name)
}

/// After agent `id`'s keys changed: its remembered check and model list are forgotten, and
/// it's checked again with them, in the background; its row follows.
pub fn keys_changed<R: Runtime>(app: &AppHandle<R>, id: &str) {
    // Before the command returns: the page asks for the models again at once.
    let forgotten = app.state::<Db>().conn().and_then(|conn| {
        agent_picks::keys_changed(
            &app.state::<Agents>(),
            &app.state::<agent_picks::Listings>(),
            &conn,
            id,
        )
    });
    if let Err(e) = forgotten {
        let _ = crate::app_log::append(app, &format!("forgetting {id}'s check: {e}"));
    }
    let (app, id) = (app.clone(), id.to_owned());
    tauri::async_runtime::spawn_blocking(move || agent_picks::recheck(&app, &id));
}

/// A call found agent `id` not ready: what was remembered of it goes now, and it's checked
/// again once the call ends ([`after_call`]), not during it.
pub fn not_ready_on_call<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let forgotten = app
        .state::<Db>()
        .conn()
        .and_then(|conn| app.state::<Agents>().invalidate(&conn, id));
    if let Err(e) = forgotten {
        let _ = crate::app_log::append(app, &format!("forgetting {id}'s check: {e}"));
    }
    app.state::<Agents>().unready_on_call(id);
}

/// When a call ends: a look, in the background, if the call found an agent not ready.
pub fn after_call<R: Runtime>(app: &AppHandle<R>) {
    if app.state::<Agents>().take_unready_on_call() {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || refresh_after_change(&app));
    }
}

/// [`refresh`] on a blocking thread, for async callers.
pub async fn refresh_in_background<R: Runtime>(app: AppHandle<R>) -> Result<Vec<AgentStatus>> {
    Ok(tauri::async_runtime::spawn_blocking(move || refresh(&app, None)).await?)
}

/// Every known agent: installed or not, its version, and its setup once probed.
/// What the last look found, so Settings never waits on a new one; only right after launch
/// does it wait for the first. Runs the user's own programs, which only read their state.
#[tauri::command]
pub async fn agents_status<R: Runtime>(app: AppHandle<R>) -> Result<Vec<AgentStatus>> {
    match app.state::<Agents>().cached() {
        Some(found) => Ok(found),
        None => refresh_in_background(app).await,
    }
}

/// Looks for the agents again (Check again) and returns what it found.
#[tauri::command]
pub async fn refresh_agents<R: Runtime>(app: AppHandle<R>) -> Result<Vec<AgentStatus>> {
    // A full check: every agent started again, with a session, and its models asked again
    // on next open.
    crate::blocking::blocking(app, |app| {
        app.state::<Agents>().forget_checks();
        app.state::<agent_picks::Listings>().forget();
        agent_checks::forget_all(&*app.state::<Db>().conn()?)?;
        // From a look that starts now: one already running read the checks and keys from
        // before this, so its answer isn't the fresh check the user asked for.
        Ok(refresh(app, Some(Vec::new())))
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::Instant;

    use super::*;

    #[test]
    fn the_launch_looks_reads_and_records_take_the_database_one_at_a_time() {
        // 0.3.2 took the database twice in one statement here and hung at launch.
        let app = crate::testing::app();
        app.state::<Db>()
            .conn()
            .unwrap()
            .execute(
                "INSERT INTO agent_picks (agent, position, setting, value)
                 VALUES ('goose', 0, 'model', 'kimi')",
                [],
            )
            .unwrap();
        let files = vec!["/Users/me/.config/goose/config.yaml".to_owned()];
        let ready = Setup {
            session: true,
            setup_files: files.clone(),
            ..Setup::default()
        };
        let fingerprint = Fingerprint::of(Path::new("/no/such/goose"), &files, &[], &[]);
        let started = app.state::<Agents>().start_check();
        record_check(app.handle(), "goose", &ready, &fingerprint, &started);

        let look = look_reads(app.handle());

        assert_eq!(
            look.picks.get("goose").map(Vec::as_slice),
            Some(
                &[Pick {
                    setting: "model".into(),
                    value: "kimi".into()
                }][..]
            )
        );
        assert!(look.remembered.contains_key("goose"));
        assert!(!app.state::<Db>().held_here());
    }

    #[test]
    fn reads_output_longer_than_a_pipe_holds() {
        // The setup probe's answer lists every model an agent offers: hundreds of KiB.
        let mut command = Command::new("sh");
        command.args(["-c", "head -c 300000 /dev/zero"]);
        let output = run(command, Duration::from_secs(5)).expect("finished in time");
        assert_eq!(output.stdout.len(), 300_000);
    }

    #[test]
    fn a_program_that_times_out_is_stopped_with_what_it_started() {
        let pid_file = std::env::temp_dir().join(format!("bomby-run-group-{}", std::process::id()));
        let mut command = Command::new("sh");
        command.args([
            "-c",
            &format!("sleep 30 & echo $! > '{}'; wait", pid_file.display()),
        ]);
        assert!(run(command, Duration::from_millis(500)).is_none());
        let pid = fs::read_to_string(&pid_file).unwrap();
        let _ = fs::remove_file(&pid_file);
        // `kill -0` fails once the sleep is gone (reaped by launchd or a zombie no more).
        let alive = || {
            Command::new("kill")
                .args(["-0", pid.trim()])
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|s| s.success())
        };
        let started = Instant::now();
        while alive() && started.elapsed() < Duration::from_secs(5) {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(!alive(), "the sleep it started outlived it");
    }

    #[test]
    fn a_program_runs_without_the_terminal_bomby_was_started_from() {
        // With a terminal of its own session's, an interactive login shell in a new group is
        // stopped as a background job reaching for it, and the lookup times out. Run from a
        // terminal (`just check`), this fails unless the program got a session of its own.
        let mut command = Command::new("sh");
        command.args([
            "-c",
            "if (: </dev/tty) 2>/dev/null; then echo terminal; else echo none; fi",
        ]);
        let output = run(command, Duration::from_secs(5)).expect("finished in time");
        assert_eq!(stdout(&output).as_deref(), Some("none"));
    }

    #[test]
    fn reads_what_a_program_wrote_while_one_it_started_still_holds_its_output() {
        // The shell exits at once; the sleep it left behind still holds its output.
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 5 & echo started"]);
        let started = Instant::now();
        let output = run(command, Duration::from_secs(1)).expect("it exited");
        assert_eq!(output.stdout, b"started\n");
        assert!(started.elapsed() < Duration::from_secs(4));
    }

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

    const NOWHERE: Known = Known {
        id: "nowhere",
        name: "Nowhere",
        binary: "nowhere",
        places: &[],
        install_page: "https://example.com/nowhere",
        check: "nowhere --version",
    };

    #[test]
    fn a_failed_shell_keeps_a_program_found_before_if_it_is_still_there() {
        let me = std::env::current_exe().unwrap();
        let previous = HashMap::from([("nowhere".to_owned(), me.clone())]);
        assert_eq!(pick_path(&NOWHERE, None, &previous, None), Some(me));

        let gone = HashMap::from([("nowhere".to_owned(), PathBuf::from("/no/such/agent"))]);
        assert_eq!(pick_path(&NOWHERE, None, &gone, None), None);
    }

    #[test]
    fn a_shell_that_answers_decides_even_over_a_program_found_before() {
        let me = std::env::current_exe().unwrap();
        let previous = HashMap::from([("nowhere".to_owned(), me)]);
        assert_eq!(
            pick_path(&NOWHERE, Some(&HashMap::new()), &previous, None),
            None
        );
    }

    fn status(id: &'static str, path: Option<&str>) -> AgentStatus {
        AgentStatus {
            id,
            name: id,
            path: path.map(str::to_owned),
            version: None,
            setup: None,
            install_page: "https://example.com/install",
            check: "nowhere --version",
        }
    }

    #[test]
    fn caches_the_last_look_and_says_when_it_changed() {
        let agents = Agents::default();
        assert_eq!(agents.cached(), None);

        let first = vec![status("claude", Some("/Users/me/.local/bin/claude"))];
        assert_eq!(
            agents.detect_with(None, |_| first.clone()),
            (first.clone(), true)
        );
        assert_eq!(agents.cached(), Some(first.clone()));
        assert_eq!(
            agents.detect_with(None, |_| first.clone()),
            (first.clone(), false)
        );

        // The next look starts from the programs found before.
        let (_, changed) = agents.detect_with(None, |previous| {
            assert_eq!(
                previous.get("claude"),
                Some(&PathBuf::from("/Users/me/.local/bin/claude"))
            );
            vec![status("claude", None)]
        });
        assert!(changed);
    }

    #[test]
    fn a_look_that_panics_keeps_what_was_found_before() {
        let agents = Agents::default();
        let first = vec![status("claude", Some("/Users/me/.local/bin/claude"))];
        agents.detect_with(None, |_| first.clone());

        let (found, changed) = agents.detect_with(None, |_| panic!("the shell fell over"));
        assert_eq!((found, changed), (first.clone(), false));
        // And the next look still runs.
        assert_eq!(agents.detect_with(None, |_| vec![]), (vec![], true));
    }

    #[test]
    fn asking_while_a_look_runs_waits_for_it_instead_of_starting_another() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let (agents, looks) = (&Agents::default(), &AtomicUsize::new(0));
        let found = &vec![status("omp", Some("/Users/me/.local/bin/omp"))];
        let (started, wait_for_start) = mpsc::channel();
        let (release, wait_for_release) = mpsc::channel::<()>();

        thread::scope(|scope| {
            let first = scope.spawn(move || {
                agents.detect_with(None, |_| {
                    looks.fetch_add(1, Ordering::SeqCst);
                    started.send(()).unwrap();
                    wait_for_release.recv().unwrap();
                    found.clone()
                })
            });
            wait_for_start.recv().unwrap();
            let second = scope.spawn(|| {
                agents.detect_with(None, |_| {
                    looks.fetch_add(1, Ordering::SeqCst);
                    vec![]
                })
            });
            while agents.lock().waiting == 0 {
                thread::yield_now();
            }
            release.send(()).unwrap();

            assert_eq!(first.join().unwrap(), (found.clone(), true));
            assert_eq!(second.join().unwrap(), (found.clone(), false));
        });
        assert_eq!(looks.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_look_starts_from_the_programs_a_call_found() {
        let agents = Agents::default();
        let goose = PathBuf::from("/Users/me/.local/bin/goose");
        let seen = vec![("goose".to_owned(), goose.clone())];
        agents.detect_with(Some(seen.clone()), |previous| {
            assert_eq!(previous.get("goose"), Some(&goose));
            vec![]
        });
        // Only that look: the next one starts from what was found.
        agents.detect_with(None, |previous| {
            assert!(previous.is_empty());
            vec![]
        });

        // A look that panics hands them on to the next one.
        agents.detect_with(Some(seen), |_| panic!("the shell fell over"));
        agents.detect_with(None, |previous| {
            assert_eq!(previous.get("goose"), Some(&goose));
            vec![]
        });
    }

    #[test]
    fn news_from_a_call_waits_for_the_running_look_then_looks_again() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let (agents, looks) = (&Agents::default(), &AtomicUsize::new(0));
        let goose = &PathBuf::from("/Users/me/.local/bin/goose");
        let stale = &vec![status("goose", None)];
        let fresh = &vec![status("goose", Some("/Users/me/.local/bin/goose"))];
        let (started, wait_for_start) = mpsc::channel();
        let (release, wait_for_release) = mpsc::channel::<()>();

        thread::scope(|scope| {
            // A look that began before goose was installed.
            let first = scope.spawn(move || {
                agents.detect_with(None, |_| {
                    looks.fetch_add(1, Ordering::SeqCst);
                    started.send(()).unwrap();
                    wait_for_release.recv().unwrap();
                    stale.clone()
                })
            });
            wait_for_start.recv().unwrap();
            // A call finds goose while it runs.
            let call = scope.spawn(move || {
                let seen = vec![("goose".to_owned(), goose.clone())];
                agents.detect_with(Some(seen), |previous| {
                    looks.fetch_add(1, Ordering::SeqCst);
                    assert_eq!(previous.get("goose"), Some(goose));
                    fresh.clone()
                })
            });
            while agents.lock().waiting == 0 {
                thread::yield_now();
            }
            release.send(()).unwrap();

            assert_eq!(first.join().unwrap(), (stale.clone(), true));
            assert_eq!(call.join().unwrap(), (fresh.clone(), true));
        });
        assert_eq!(looks.load(Ordering::SeqCst), 2);
        assert_eq!(agents.cached(), Some(fresh.clone()));
    }

    #[test]
    fn a_change_on_disk_waits_for_the_running_look_then_looks_again() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let (agents, looks) = (&Agents::default(), &AtomicUsize::new(0));
        let (started, wait_for_start) = mpsc::channel();
        let (release, wait_for_release) = mpsc::channel::<()>();
        thread::scope(|scope| {
            scope.spawn(move || {
                agents.detect_with(None, |_| {
                    looks.fetch_add(1, Ordering::SeqCst);
                    started.send(()).unwrap();
                    wait_for_release.recv().unwrap();
                    vec![]
                })
            });
            wait_for_start.recv().unwrap();
            let after = scope.spawn(|| {
                agents.detect_with(Some(Vec::new()), |_| {
                    looks.fetch_add(1, Ordering::SeqCst);
                    vec![status("claude", Some("/Users/me/.local/bin/claude"))]
                })
            });
            while agents.lock().waiting == 0 {
                thread::yield_now();
            }
            release.send(()).unwrap();
            let (found, _) = after.join().unwrap();
            assert_eq!(found.len(), 1);
        });
        assert_eq!(looks.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn programs_match_installed_for_the_same_agents() {
        let claude = PathBuf::from("/Users/me/.local/bin/claude");
        let found = programs(vec![(&KNOWN[0], Some(claude.clone())), (&KNOWN[2], None)]);
        let shown = installed(&[
            status("claude", Some("/Users/me/.local/bin/claude")),
            status("opencode", None),
        ]);
        assert_eq!(found, shown);
        assert_eq!(found, vec![("claude".to_owned(), claude)]);
    }

    fn ready(model: &str) -> Setup {
        Setup {
            model: Some(model.into()),
            session: true,
            ..Setup::default()
        }
    }

    fn needs_setup() -> Setup {
        Setup {
            step: Step::SignIn,
            problem: Some("No model is set".into()),
            session: true,
            ..Setup::default()
        }
    }

    #[test]
    fn a_pick_replaces_only_that_agents_setup() {
        let agents = Agents::default();
        assert_eq!(
            agents.picked("goose", &ready("x")),
            None,
            "nothing found yet"
        );

        let shown = vec![
            status("goose", Some("/b/goose")),
            status("omp", Some("/b/omp")),
        ];
        agents.detect_with(None, |_| shown.clone());
        let found = agents.picked("goose", &ready("Kimi")).unwrap();

        assert_eq!(found[0].setup, Some(ready("Kimi")));
        assert_eq!(found[1], shown[1], "the others stay as they were");
        assert_eq!(agents.cached(), Some(found));
        assert_eq!(
            agents.replace_setup("goose", &ready("Kimi")),
            None,
            "nothing changed, so there's nothing to tell the windows"
        );
    }

    #[test]
    fn a_look_that_started_before_a_pick_keeps_the_pick() {
        let agents = Agents::default();
        let goose = |setup| AgentStatus {
            setup: Some(setup),
            ..status("goose", Some("/b/goose"))
        };
        agents.detect_with(None, |_| vec![goose(ready("old"))]);

        let (found, _) = agents.detect_with(None, |_| {
            // The user picks while the look runs; the look saw the picks from before.
            agents.picked("goose", &ready("picked"));
            vec![goose(ready("old"))]
        });
        assert_eq!(found, vec![goose(ready("picked"))]);

        let (found, _) = agents.detect_with(None, |_| vec![goose(ready("next"))]);
        assert_eq!(
            found,
            vec![goose(ready("next"))],
            "a later look decides again"
        );
    }

    #[test]
    fn a_problem_found_while_picking_still_shows() {
        let signed_out = Setup {
            step: Step::SignIn,
            problem: Some("Not signed in".into()),
            fix: Some("goose configure".into()),
            ..Setup::default()
        };
        let timed_out = Setup {
            step: Step::Unreachable,
            problem: Some("It didn't answer in time".into()),
            ..Setup::default()
        };
        for problem in [signed_out, timed_out] {
            let agents = Agents::default();
            let goose = |setup| AgentStatus {
                setup: Some(setup),
                ..status("goose", Some("/b/goose"))
            };
            agents.detect_with(None, |_| vec![goose(ready("old"))]);

            let (found, _) = agents.detect_with(None, |_| {
                agents.picked("goose", &ready("picked"));
                vec![goose(problem.clone())]
            });
            assert_eq!(found, vec![goose(problem)]);
            assert!(usable(&found).is_empty(), "calls don't get it");
        }
    }

    #[test]
    fn a_failure_that_cant_name_its_keys_keeps_the_fields_its_row_showed() {
        // goose waiting on macOS's keychain prompt times out without a session, so the
        // probe can't tell its provider: the key that stops the prompt must stay savable.
        let key = setup::KeyField {
            name: "OPENROUTER_API_KEY".into(),
            label: "OpenRouter API key".into(),
            secret: true,
            optional: false,
        };
        let keyed = Setup {
            session: true,
            keys: vec![key.clone()],
            ..ready("Kimi")
        };
        let timed_out = Setup {
            step: Step::Unreachable,
            problem: Some("It didn't answer in time".into()),
            timed_out: true,
            ..Setup::default()
        };
        let goose = |setup| AgentStatus {
            setup: Some(setup),
            ..status("goose", Some("/b/goose"))
        };
        let with_key = Setup {
            keys: vec![key],
            ..timed_out.clone()
        };

        // A look.
        let agents = Agents::default();
        agents.detect_with(None, |_| vec![goose(keyed.clone())]);
        let (found, _) = agents.detect_with(None, |_| vec![goose(timed_out.clone())]);
        assert_eq!(found, vec![goose(with_key.clone())]);

        // The model picker's check, through its row.
        let agents = Agents::default();
        agents.detect_with(None, |_| vec![goose(keyed.clone())]);
        agents.replace_setup("goose", &timed_out);
        assert_eq!(agents.offered_keys("goose"), ["OPENROUTER_API_KEY"]);
        assert!(
            agents.offers_key("goose", "OPENROUTER_API_KEY"),
            "so it can be saved"
        );

        // A session that names none (a provider without a key) is believed.
        let keyless = Setup {
            session: true,
            ..ready("Llama")
        };
        agents.replace_setup("goose", &keyless);
        assert!(agents.offered_keys("goose").is_empty());
    }

    #[test]
    fn a_first_look_that_times_out_offers_the_fields_a_session_offered_at_an_earlier_launch() {
        // goose at launch, waiting on macOS's keychain prompt, with no provider the probe
        // can read and no row yet this run: the field comes from the last session.
        let key = setup::KeyField {
            name: "OPENROUTER_API_KEY".into(),
            label: "OpenRouter API key".into(),
            secret: true,
            optional: false,
        };
        let timed_out = Setup {
            step: Step::Unreachable,
            problem: Some("It didn't answer in time".into()),
            timed_out: true,
            takes_keys: true,
            ..Setup::default()
        };
        let goose = |setup| AgentStatus {
            setup: Some(setup),
            ..status("goose", Some("/b/goose"))
        };
        let first_look = |app: &tauri::App<tauri::test::MockRuntime>| {
            let shown = look_reads(app.handle()).shown("goose", timed_out.clone());
            let agents = Agents::default();
            agents.detect_with(None, |_| vec![goose(shown)]);
            agents
        };

        // Never a session with goose: no field, but the row knows it takes keys.
        let app = crate::testing::app();
        let agents = first_look(&app);
        assert!(agents.offered_keys("goose").is_empty());
        let shown = agents.cached().unwrap()[0].setup.clone().unwrap();
        assert!(shown.takes_keys && shown.timed_out);

        // A session at an earlier launch named its key: this launch's first look offers it.
        let app = crate::testing::app();
        let earlier = Setup {
            session: true,
            keys: vec![key.clone()],
            ..ready("Kimi")
        };
        let started = app.state::<Agents>().start_check();
        record_key_fields(app.handle(), "goose", &earlier, &started);
        let agents = first_look(&app);
        assert_eq!(agents.offered_keys("goose"), ["OPENROUTER_API_KEY"]);
        assert!(
            agents.offers_key("goose", "OPENROUTER_API_KEY"),
            "so it can be saved"
        );

        // A probe that names keys itself (from a pick or goose's config) is believed.
        let anthropic = setup::KeyField {
            name: "ANTHROPIC_API_KEY".into(),
            label: "Anthropic API key".into(),
            ..key
        };
        let named = Setup {
            keys: vec![anthropic.clone()],
            ..timed_out.clone()
        };
        assert_eq!(
            look_reads(app.handle()).shown("goose", named).keys,
            vec![anthropic]
        );
    }

    #[test]
    fn a_session_found_before_a_pick_or_a_key_change_keeps_no_key_fields() {
        let app = crate::testing::app();
        let agents = app.state::<Agents>();
        let keyed = Setup {
            session: true,
            keys: vec![setup::KeyField {
                name: "OPENROUTER_API_KEY".into(),
                label: "OpenRouter API key".into(),
                secret: true,
                optional: false,
            }],
            ..ready("Kimi")
        };
        let started = agents.start_check();
        agents.picked("goose", &keyed);
        record_key_fields(app.handle(), "goose", &keyed, &started);
        let started = agents.start_check();
        agents.revise("goose");
        record_key_fields(app.handle(), "goose", &keyed, &started);

        assert!(look_reads(app.handle()).key_fields.is_empty());
    }

    #[test]
    fn a_look_keeps_its_answer_over_a_listing_made_while_it_ran() {
        let agents = Agents::default();
        let goose = |setup| AgentStatus {
            setup: Some(setup),
            ..status("goose", Some("/b/goose"))
        };
        agents.detect_with(None, |_| vec![goose(ready("old"))]);

        let (found, _) = agents.detect_with(None, |_| {
            // The picker opens while the look runs: it changes nothing the look misses.
            agents.replace_setup("goose", &ready("listed"));
            vec![goose(ready("looked"))]
        });
        assert_eq!(found, vec![goose(ready("looked"))]);
    }

    #[test]
    fn an_agent_is_checked_with_a_session_once_per_launch() {
        let agents = Agents::default();
        let omp = |setup| AgentStatus {
            setup: Some(setup),
            ..status("omp", Some("/b/omp"))
        };
        agents.detect_with(None, |_| vec![omp(Setup::default())]);
        assert!(agents.lock().checked.is_empty(), "no session yet");

        agents.detect_with(None, |_| vec![omp(ready("Kimi"))]);
        assert!(agents.lock().checked.contains("omp"));
    }

    #[test]
    fn a_look_without_a_session_keeps_what_the_last_session_found() {
        let omp = |setup| AgentStatus {
            setup: Some(setup),
            ..status("omp", Some("/b/omp"))
        };
        let no_model = Setup {
            step: Step::SignIn,
            problem: Some("No model is set".into()),
            session: true,
            ..Setup::default()
        };
        for checked in [ready("Kimi"), no_model] {
            let agents = Agents::default();
            agents.detect_with(None, |_| vec![omp(checked.clone())]);

            // A later look opens no session: it sees only that omp starts.
            let (found, _) = agents.detect_with(None, |_| vec![omp(Setup::default())]);
            assert_eq!(found, vec![omp(checked)]);
        }
    }

    #[test]
    fn calls_leave_out_only_programs_the_probe_found_not_set_up() {
        let goose = |setup| AgentStatus {
            setup,
            ..status("goose", Some("/Users/me/.local/bin/goose"))
        };
        let omp = status("omp", Some("/Users/me/.local/bin/omp"));
        let shown = [goose(Some(needs_setup())), omp];
        assert_eq!(
            usable(&shown),
            vec![("omp".to_owned(), PathBuf::from("/Users/me/.local/bin/omp"))]
        );

        let found = vec![
            (
                "goose".to_owned(),
                PathBuf::from("/Users/me/.local/bin/goose"),
            ),
            ("omp".to_owned(), PathBuf::from("/Users/me/.local/bin/omp")),
        ];
        assert_eq!(without_unready(found.clone(), &shown), found[1..]);
        // A goose moved or reinstalled elsewhere hasn't been probed there yet.
        let moved = vec![("goose".to_owned(), PathBuf::from("/opt/homebrew/bin/goose"))];
        assert_eq!(without_unready(moved.clone(), &shown), moved);
        assert_eq!(
            without_unready(found.clone(), &[goose(Some(ready("x")))]),
            found
        );
    }

    #[test]
    fn installed_lists_only_agents_with_a_program() {
        let agents = [
            status("claude", Some("/Users/me/.local/bin/claude")),
            status("goose", None),
        ];
        assert_eq!(
            installed(&agents),
            vec![(
                "claude".to_owned(),
                PathBuf::from("/Users/me/.local/bin/claude")
            )]
        );
    }

    #[test]
    fn a_look_reuses_a_remembered_check_only_while_it_holds() {
        let goose = std::env::current_exe().unwrap();
        let files = vec!["/Users/me/.config/goose/config.yaml".to_owned()];
        let setup = Setup {
            setup_files: files.clone(),
            ..ready("Kimi")
        };
        let remembered = |look: &Look| Remembered {
            setup: setup.clone(),
            fingerprint: look.fingerprint("goose", &goose, &files),
            checked_at: 1_000,
        };
        let mut look = Look::default();
        look.remembered
            .insert("goose".into(), remembered(&Look::default()));

        assert_eq!(
            look.still_holds("goose", &goose, 2_000),
            Some(setup.clone())
        );
        assert_eq!(
            look.still_holds("omp", &goose, 2_000),
            None,
            "none remembered"
        );
        assert_eq!(
            look.still_holds("goose", Path::new("/no/such/goose"), 2_000),
            None,
            "another program"
        );

        // A key saved since, or a pick: checked again.
        look.keys = AgentKeys::from([(
            "goose".into(),
            std::collections::BTreeMap::from([("OPENROUTER_API_KEY".into(), "k".into())]),
        )]);
        assert_eq!(look.still_holds("goose", &goose, 2_000), None);
        look.keys.clear();
        look.picks = HashMap::from([(
            "goose".into(),
            vec![Pick {
                setting: "provider".into(),
                value: "openrouter".into(),
            }],
        )]);
        assert_eq!(look.still_holds("goose", &goose, 2_000), None);
    }

    #[test]
    fn a_key_is_saved_only_in_a_variable_the_agent_asks_for() {
        let agents = Agents::default();
        assert!(
            !agents.offers_key("goose", "OPENROUTER_API_KEY"),
            "nothing found"
        );
        let keyed = Setup {
            keys: vec![setup::KeyField {
                name: "OPENROUTER_API_KEY".into(),
                label: "OpenRouter API key".into(),
                secret: true,
                optional: false,
            }],
            ..ready("Kimi")
        };
        agents.detect_with(None, |_| {
            vec![AgentStatus {
                setup: Some(keyed.clone()),
                ..status("goose", Some("/b/goose"))
            }]
        });
        assert!(agents.offers_key("goose", "OPENROUTER_API_KEY"));
        assert!(!agents.offers_key("goose", "ANTHROPIC_API_KEY"));
        assert!(!agents.offers_key("omp", "OPENROUTER_API_KEY"));
    }

    #[test]
    fn a_look_that_started_before_a_key_change_doesnt_undo_its_recheck() {
        let agents = Agents::default();
        let goose = |setup| AgentStatus {
            setup: Some(setup),
            ..status("goose", Some("/b/goose"))
        };
        let signed_out = Setup {
            step: Step::SignIn,
            problem: Some("Not signed in".into()),
            session: true,
            ..Setup::default()
        };
        agents.detect_with(None, |_| vec![goose(signed_out.clone())]);

        let (found, _) = agents.detect_with(None, |_| {
            // A working key is saved while the look runs on the old one; its recheck answers.
            agents.revise("goose");
            agents.picked("goose", &ready("Kimi"));
            vec![goose(signed_out.clone())]
        });
        assert_eq!(found, vec![goose(ready("Kimi"))]);
        assert_eq!(usable(&found).len(), 1, "calls get it");

        let (found, _) = agents.detect_with(None, |_| vec![goose(signed_out.clone())]);
        assert_eq!(
            found,
            vec![goose(signed_out)],
            "a look that starts after decides"
        );
    }

    #[test]
    fn a_check_that_started_before_its_keys_changed_isnt_recorded() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        let agents = Agents::default();
        let setup = Setup {
            setup_files: vec!["/Users/me/.config/goose/config.yaml".into()],
            ..ready("Kimi")
        };
        let fingerprint =
            Fingerprint::of(Path::new("/no/such/goose"), &setup.setup_files, &[], &[]);

        let before = agents.start_check();
        // A key saved (or a call that found it not ready) while it ran.
        agents.invalidate(&conn, "goose").unwrap();
        agents
            .record_check(&conn, "goose", &setup, &fingerprint, &before)
            .unwrap();
        assert!(agent_checks::all(&conn).unwrap().is_empty());

        // The check that starts after it is recorded.
        let after = agents.start_check();
        agents
            .record_check(&conn, "goose", &setup, &fingerprint, &after)
            .unwrap();
        assert!(agent_checks::all(&conn).unwrap().contains_key("goose"));
        // Another agent's change doesn't hold this one up.
        let omp_started = agents.start_check();
        agents.invalidate(&conn, "omp").unwrap();
        agents
            .record_check(&conn, "goose", &setup, &fingerprint, &omp_started)
            .unwrap();
        assert!(agent_checks::all(&conn).unwrap().contains_key("goose"));
    }

    #[test]
    fn an_agent_not_ready_on_a_call_is_checked_once_after_it() {
        let agents = Agents::default();
        assert!(!agents.take_unready_on_call());
        agents.unready_on_call("goose");
        agents.unready_on_call("goose");
        assert!(agents.take_unready_on_call());
        assert!(!agents.take_unready_on_call(), "once");
    }

    /// The windows that show Install may open every agent's page (`capabilities/`).
    #[test]
    fn every_install_page_is_allowed_in_the_windows_that_show_install() {
        for capability in [
            include_str!("../capabilities/main.json"),
            include_str!("../capabilities/settings.json"),
        ] {
            let capability: serde_json::Value = serde_json::from_str(capability).unwrap();
            let allowed: Vec<&str> = capability["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|p| p["identifier"] == "opener:allow-open-url")
                .flat_map(|p| p["allow"].as_array().unwrap())
                .filter_map(|url| url["url"].as_str())
                .collect();
            for known in KNOWN {
                assert!(
                    allowed.contains(&known.install_page),
                    "{} may not open {}",
                    capability["identifier"],
                    known.install_page
                );
            }
        }
    }
}
