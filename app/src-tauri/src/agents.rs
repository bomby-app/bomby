//! The agents Bomby can hand work to, found on the user's computer
//! (docs/decisions/detect-acp-native-agents.md). The app never ships or signs in to them;
//! it finds the user's own install and tells the voice agent where it is.
//!
//! Adding one is a row in `KNOWN` here and a harness definition in `agent/harnesses/`,
//! under the same id.
//!
//! Finding them runs the user's login shell and each agent's own program, which takes
//! seconds, so the core does it once at launch, in the background, and keeps the result in
//! [`Agents`]. Settings shows what is kept and asks for a fresh look without waiting on it;
//! each call looks again before it opens.

use std::collections::HashMap;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::error::Result;

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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignIn {
    signed_in: bool,
    /// What to run in Terminal to sign in.
    login: &'static str,
    /// The account's plan, e.g. "max" or "pro".
    plan: Option<String>,
}

/// What Settings shows for one agent.
#[derive(Debug, Clone, PartialEq, Serialize)]
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
    run(lookup)
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

/// Finds each known agent the way a terminal would, then in its usual install places.
fn find_all(previous: &HashMap<String, PathBuf>) -> Vec<(&'static Known, Option<PathBuf>)> {
    let from_shell = shell_paths();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    KNOWN
        .iter()
        .map(|known| {
            let path = pick_path(known, from_shell.as_ref(), previous, home.as_deref());
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

/// Every known agent with its status. Each agent's own checks run side by side, so a look
/// takes about as long as the shell and the slowest agent.
fn detect_all(previous: &HashMap<String, PathBuf>) -> Vec<AgentStatus> {
    let found = find_all(previous);
    thread::scope(|scope| {
        let checks: Vec<_> = found
            .into_iter()
            .map(|(known, path)| (known, scope.spawn(move || status_of(known, path))))
            .collect();
        checks
            .into_iter()
            .map(|(known, check)| check.join().unwrap_or_else(|_| status_of(known, None)))
            .collect()
    })
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
}

impl Agents {
    fn lock(&self) -> MutexGuard<'_, Detection> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// What the last look found, if one has finished.
    pub fn cached(&self) -> Option<Vec<AgentStatus>> {
        self.lock().found.clone()
    }

    /// Looks again, or waits for the look already running, and returns what it found and
    /// whether that differs from before. Blocks for as long as the look takes.
    pub fn detect(&self) -> (Vec<AgentStatus>, bool) {
        self.detect_with(detect_all)
    }

    fn detect_with(
        &self,
        look: impl FnOnce(&HashMap<String, PathBuf>) -> Vec<AgentStatus>,
    ) -> (Vec<AgentStatus>, bool) {
        let mut state = self.lock();
        if state.running {
            let look = state.looks;
            state.waiting += 1;
            let mut state = self
                .finished
                .wait_while(state, |s| s.looks == look)
                .unwrap_or_else(PoisonError::into_inner);
            state.waiting -= 1;
            // The look's own caller tells the windows about a change.
            return (state.found.clone().unwrap_or_default(), false);
        }
        state.running = true;
        let previous: HashMap<_, _> = state
            .found
            .as_deref()
            .map(installed)
            .unwrap_or_default()
            .into_iter()
            .collect();
        drop(state);

        // A look that panics keeps what was found before, and never leaves waiters waiting.
        let found = panic::catch_unwind(AssertUnwindSafe(|| look(&previous)));

        let mut state = self.lock();
        let changed = match found {
            Ok(found) => {
                let changed = state.found.as_ref() != Some(&found);
                state.found = Some(found);
                changed
            }
            Err(_) => false,
        };
        state.running = false;
        state.looks += 1;
        self.finished.notify_all();
        (state.found.clone().unwrap_or_default(), changed)
    }
}

/// Looks for the agents (blocking) and tells every window when they changed.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) -> Vec<AgentStatus> {
    let (found, changed) = app.state::<Agents>().detect();
    if changed {
        // Only fails for an invalid event name or payload; a window that misses it still
        // gets the list when it asks.
        let _ = app.emit(CHANGED, &found);
    }
    found
}

/// [`refresh`] on a blocking thread, for async callers.
pub async fn refresh_in_background<R: Runtime>(app: AppHandle<R>) -> Result<Vec<AgentStatus>> {
    Ok(tauri::async_runtime::spawn_blocking(move || refresh(&app)).await?)
}

/// Every known agent: installed or not, its version, and its sign-in where it reports one.
/// What the last look found, so Settings never waits on a new one; only right after launch
/// does it wait for the first. Runs the user's own programs, which only read their state.
#[tauri::command]
pub async fn agents_status<R: Runtime>(app: AppHandle<R>) -> Result<Vec<AgentStatus>> {
    match app.state::<Agents>().cached() {
        Some(found) => Ok(found),
        None => refresh_in_background(app).await,
    }
}

/// Looks for the agents again (Check again, or Settings opening) and returns what it found.
#[tauri::command]
pub async fn refresh_agents<R: Runtime>(app: AppHandle<R>) -> Result<Vec<AgentStatus>> {
    refresh_in_background(app).await
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

    const NOWHERE: Known = Known {
        id: "nowhere",
        name: "Nowhere",
        binary: "nowhere",
        places: &[],
        sign_in: None,
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
            sign_in: None,
        }
    }

    #[test]
    fn caches_the_last_look_and_says_when_it_changed() {
        let agents = Agents::default();
        assert_eq!(agents.cached(), None);

        let first = vec![status("claude", Some("/Users/me/.local/bin/claude"))];
        assert_eq!(agents.detect_with(|_| first.clone()), (first.clone(), true));
        assert_eq!(agents.cached(), Some(first.clone()));
        assert_eq!(
            agents.detect_with(|_| first.clone()),
            (first.clone(), false)
        );

        // The next look starts from the programs found before.
        let (_, changed) = agents.detect_with(|previous| {
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
        agents.detect_with(|_| first.clone());

        let (found, changed) = agents.detect_with(|_| panic!("the shell fell over"));
        assert_eq!((found, changed), (first.clone(), false));
        // And the next look still runs.
        assert_eq!(agents.detect_with(|_| vec![]), (vec![], true));
    }

    #[test]
    fn asking_while_a_look_runs_waits_for_it_instead_of_starting_another() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::mpsc;

        let (agents, looks) = (&Agents::default(), &AtomicUsize::new(0));
        let found = &vec![status("omp", Some("/Users/me/.local/bin/omp"))];
        let (started, wait_for_start) = mpsc::channel();
        let (release, wait_for_release) = mpsc::channel::<()>();

        thread::scope(|scope| {
            let first = scope.spawn(move || {
                agents.detect_with(|_| {
                    looks.fetch_add(1, Ordering::SeqCst);
                    started.send(()).unwrap();
                    wait_for_release.recv().unwrap();
                    found.clone()
                })
            });
            wait_for_start.recv().unwrap();
            let second = scope.spawn(|| {
                agents.detect_with(|_| {
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
}
