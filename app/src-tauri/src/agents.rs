//! The agents Bomby can hand work to, found on the user's computer
//! (docs/decisions/detect-acp-native-agents.md). The app never ships or signs in to them;
//! it finds the user's own install and tells the voice agent where it is.
//!
//! Adding one is a row in `KNOWN` here and a harness definition in `agent/harnesses/`,
//! under the same id. Whether it is set up comes from the harness, through the probe
//! ([`setup`](crate::setup)).
//!
//! Finding them runs the user's login shell and each agent's own program, which takes
//! seconds, so the core does it once at launch, in the background, and keeps the result in
//! [`Agents`]. Settings shows what is kept and asks for a fresh look without waiting on it;
//! each call looks again before it opens. After a look, agents whose setup isn't known yet
//! are probed, and Settings gets the answer as another change.

use std::collections::HashMap;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::db::Db;
use crate::error::Result;
use crate::setup::{self, Checked, Setup};

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
    },
];

/// What Settings shows for one agent.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    id: &'static str,
    name: &'static str,
    /// Where its program is, or `None` when it isn't installed (or can't be found).
    path: Option<String>,
    version: Option<String>,
    /// `None` until the probe has checked this program and version, or when it can't run.
    setup: Option<Setup>,
}

/// Runs `command` and returns its output if it finishes within `timeout`; kills it
/// otherwise.
pub fn run(mut command: Command, timeout: Duration) -> Option<Output> {
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
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(50)),
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

fn status_of(known: &'static Known, path: Option<PathBuf>) -> AgentStatus {
    let Some(path) = path else {
        return AgentStatus {
            id: known.id,
            name: known.name,
            path: None,
            version: None,
            setup: None,
        };
    };
    let mut version = Command::new(&path);
    version.arg("--version");
    AgentStatus {
        id: known.id,
        name: known.name,
        version: run(version, TIMEOUT).as_ref().and_then(stdout),
        path: Some(path.display().to_string()),
        setup: None,
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
    /// Programs a call found that the next look starts from, so a login shell that fails
    /// then doesn't lose them.
    seen: HashMap<String, PathBuf>,
    /// What the probe found, by agent id.
    checked: HashMap<String, Checked>,
    probing: bool,
}

/// Fills in each agent's setup from what the probe found for that same program and version.
fn with_setups(found: &mut [AgentStatus], checked: &HashMap<String, Checked>) {
    for agent in found {
        agent.setup = checked
            .get(agent.id)
            .filter(|c| Some(&c.path) == agent.path.as_ref() && c.version == agent.version)
            .map(|c| c.setup.clone());
    }
}

impl Agents {
    /// Starts from what earlier probes found.
    pub fn new(checked: HashMap<String, Checked>) -> Self {
        Self {
            state: Mutex::new(Detection {
                checked,
                ..Detection::default()
            }),
            finished: Condvar::new(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Detection> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// What the last look found, if one has finished.
    pub fn cached(&self) -> Option<Vec<AgentStatus>> {
        self.lock().found.clone()
    }

    /// Looks again, or waits for the look already running, and returns what it found and
    /// whether that differs from before. Blocks for as long as the look takes.
    ///
    /// With `seen`, the programs a call just found, the answer comes from a look that starts
    /// after this one asked, and that look starts from them: a look already running began
    /// before they were found, so it may miss them.
    pub fn detect(&self, seen: Option<Vec<(String, PathBuf)>>) -> (Vec<AgentStatus>, bool) {
        self.detect_with(seen, detect_all)
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
        drop(state);

        // A look that panics keeps what was found before, and never leaves waiters waiting.
        let found = panic::catch_unwind(AssertUnwindSafe(|| look(&previous)));

        let mut state = self.lock();
        let changed = match found {
            Ok(mut found) => {
                with_setups(&mut found, &state.checked);
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

impl Agents {
    /// The installed agents in `found` the probe should check: all of them on `recheck`,
    /// otherwise those never checked at this program and version, or not ready last time.
    /// Empty while a probe runs, which reports when it is done.
    fn due(&self, found: &[AgentStatus], recheck: bool) -> Vec<AgentStatus> {
        let mut state = self.lock();
        if state.probing {
            return Vec::new();
        }
        let due: Vec<_> = found
            .iter()
            .filter(|a| a.path.is_some() && (recheck || a.setup.as_ref().is_none_or(|s| !s.ready)))
            .cloned()
            .collect();
        state.probing = !due.is_empty();
        due
    }

    /// Keeps what the probe found for `due` (nothing when it couldn't run), and returns the
    /// agents with it, whether that changed them, and every result to save.
    fn record(
        &self,
        due: &[AgentStatus],
        mut setups: HashMap<String, Setup>,
    ) -> (Vec<AgentStatus>, bool, HashMap<String, Checked>) {
        let mut state = self.lock();
        state.probing = false;
        for agent in due {
            let (Some(setup), Some(path)) = (setups.remove(agent.id), agent.path.clone()) else {
                continue;
            };
            let version = agent.version.clone();
            state.checked.insert(
                agent.id.to_owned(),
                Checked {
                    path,
                    version,
                    setup,
                },
            );
        }
        let Some(before) = state.found.clone() else {
            return (Vec::new(), false, state.checked.clone());
        };
        let mut after = before.clone();
        with_setups(&mut after, &state.checked);
        let changed = after != before;
        state.found = Some(after.clone());
        (after, changed, state.checked.clone())
    }
}

/// The installed agents' programs, looked up now: the shell and the install places only,
/// without the version and sign-in checks, which a call doesn't need. Blocks for the shell
/// lookup. When they differ from what Settings shows, a full look starting from them
/// follows in the background, so Settings catches up.
pub fn installed_now<R: Runtime>(app: &AppHandle<R>) -> Vec<(String, PathBuf)> {
    let shown = app
        .state::<Agents>()
        .cached()
        .map(|found| installed(&found));
    let previous: HashMap<_, _> = shown.clone().unwrap_or_default().into_iter().collect();
    let found = programs(find_all(&previous));
    if shown.as_ref() != Some(&found) {
        let (app, seen) = (app.clone(), found.clone());
        tauri::async_runtime::spawn_blocking(move || refresh(&app, Some(seen), false));
    }
    found
}

/// The ones `find_all` found, by id with their programs, in `KNOWN` order like
/// [`installed`].
fn programs(found: Vec<(&'static Known, Option<PathBuf>)>) -> Vec<(String, PathBuf)> {
    found
        .into_iter()
        .filter_map(|(known, path)| Some((known.id.to_owned(), path?)))
        .collect()
}

/// Looks for the agents (blocking), starting from what a call has `seen`, then probes the
/// ones due (all of them on `recheck`), and tells every window each time they change.
fn refresh<R: Runtime>(
    app: &AppHandle<R>,
    seen: Option<Vec<(String, PathBuf)>>,
    recheck: bool,
) -> Vec<AgentStatus> {
    let agents = app.state::<Agents>();
    let (found, changed) = agents.detect(seen);
    if changed {
        // Only fails for an invalid event name or payload; a window that misses it still
        // gets the list when it asks.
        let _ = app.emit(CHANGED, &found);
    }
    let due = agents.due(&found, recheck);
    if due.is_empty() {
        return found;
    }
    let setups = panic::catch_unwind(|| setup::probe(&installed(&due)))
        .ok()
        .flatten()
        .unwrap_or_default();
    let (found, changed, checked) = agents.record(&due, setups);
    if changed {
        let _ = app.emit(CHANGED, &found);
        let _ = setup::save(&app.state::<Db>().conn(), &checked);
    }
    found
}

/// [`refresh`] on a blocking thread, for async callers.
pub async fn refresh_in_background<R: Runtime>(
    app: AppHandle<R>,
    recheck: bool,
) -> Result<Vec<AgentStatus>> {
    Ok(tauri::async_runtime::spawn_blocking(move || refresh(&app, None, recheck)).await?)
}

/// Every known agent: installed or not, its version, and its setup once probed.
/// What the last look found, so Settings never waits on a new one; only right after launch
/// does it wait for the first. Runs the user's own programs, which only read their state.
#[tauri::command]
pub async fn agents_status<R: Runtime>(app: AppHandle<R>) -> Result<Vec<AgentStatus>> {
    match app.state::<Agents>().cached() {
        Some(found) => Ok(found),
        None => refresh_in_background(app, false).await,
    }
}

/// Looks for the agents again and returns what it found: quietly when Settings opens, and
/// with every installed agent probed again on Check again (`recheck`).
#[tauri::command]
pub async fn refresh_agents<R: Runtime>(
    app: AppHandle<R>,
    recheck: bool,
) -> Result<Vec<AgentStatus>> {
    refresh_in_background(app, recheck).await
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
        use std::sync::mpsc;

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
        use std::sync::mpsc;

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
    fn programs_match_installed_for_the_same_agents() {
        let claude = PathBuf::from("/Users/me/.local/bin/claude");
        let found = programs(vec![(&KNOWN[0], Some(claude.clone())), (&KNOWN[1], None)]);
        let shown = installed(&[
            status("claude", Some("/Users/me/.local/bin/claude")),
            status("opencode", None),
        ]);
        assert_eq!(found, shown);
        assert_eq!(found, vec![("claude".to_owned(), claude)]);
    }

    fn ready(model: &str) -> Setup {
        Setup {
            ready: true,
            problem: None,
            fix: None,
            account: None,
            model: Some(model.into()),
        }
    }

    fn needs_setup() -> Setup {
        Setup {
            ready: false,
            problem: Some("No model is set".into()),
            fix: None,
            account: None,
            model: None,
        }
    }

    fn checked(path: &str, version: &str, setup: Setup) -> Checked {
        Checked {
            path: path.into(),
            version: Some(version.into()),
            setup,
        }
    }

    fn versioned(id: &'static str, path: &str, version: &str) -> AgentStatus {
        AgentStatus {
            version: Some(version.into()),
            ..status(id, Some(path))
        }
    }

    #[test]
    fn a_setup_applies_only_to_the_program_and_version_it_was_probed_at() {
        let stored = HashMap::from([(
            "omp".to_owned(),
            checked("/Users/me/.local/bin/omp", "18.16.0", ready("K3.1 Pro")),
        )]);
        let mut found = vec![
            versioned("omp", "/Users/me/.local/bin/omp", "18.16.0"),
            versioned("goose", "/Users/me/.local/bin/goose", "1.57.0"),
        ];
        with_setups(&mut found, &stored);
        assert_eq!(found[0].setup, Some(ready("K3.1 Pro")));
        assert_eq!(found[1].setup, None);

        let mut upgraded = vec![versioned("omp", "/Users/me/.local/bin/omp", "18.17.0")];
        with_setups(&mut upgraded, &stored);
        assert_eq!(upgraded[0].setup, None);
    }

    #[test]
    fn probes_what_is_unknown_or_not_ready_and_everything_on_recheck() {
        let agents = Agents::new(HashMap::from([
            (
                "claude".to_owned(),
                checked("/Users/me/.local/bin/claude", "2.1.317", ready("Opus 5.5")),
            ),
            (
                "goose".to_owned(),
                checked("/Users/me/.local/bin/goose", "1.57.0", needs_setup()),
            ),
        ]));
        let (found, _) = agents.detect_with(None, |_| {
            vec![
                versioned("claude", "/Users/me/.local/bin/claude", "2.1.317"),
                versioned("goose", "/Users/me/.local/bin/goose", "1.57.0"),
                versioned("omp", "/Users/me/.local/bin/omp", "18.16.0"),
                status("opencode", None),
            ]
        });
        let ids = |due: Vec<AgentStatus>| due.iter().map(|a| a.id).collect::<Vec<_>>();

        assert_eq!(ids(agents.due(&found, false)), ["goose", "omp"]);
        // One probe at a time; the running one reports when it's done.
        assert!(agents.due(&found, true).is_empty());
        agents.record(&[], HashMap::new());
        assert_eq!(ids(agents.due(&found, true)), ["claude", "goose", "omp"]);
    }

    #[test]
    fn a_probe_result_updates_the_shown_agents_and_is_kept() {
        let agents = Agents::default();
        let omp = versioned("omp", "/Users/me/.local/bin/omp", "18.16.0");
        let (found, _) = agents.detect_with(None, |_| vec![omp.clone()]);
        let due = agents.due(&found, false);

        let (found, changed, kept) =
            agents.record(&due, HashMap::from([("omp".to_owned(), ready("K3.1 Pro"))]));
        assert!(changed);
        assert_eq!(found[0].setup, Some(ready("K3.1 Pro")));
        assert_eq!(agents.cached(), Some(found));
        assert_eq!(
            kept["omp"],
            checked("/Users/me/.local/bin/omp", "18.16.0", ready("K3.1 Pro"))
        );

        // The next look shows it at once, and the probe has nothing left to do.
        let (found, changed) = agents.detect_with(None, |_| vec![omp.clone()]);
        assert!(!changed);
        assert!(agents.due(&found, false).is_empty());
    }

    #[test]
    fn a_probe_that_couldnt_run_changes_nothing() {
        let agents = Agents::default();
        let (found, _) = agents.detect_with(None, |_| {
            vec![versioned("omp", "/Users/me/.local/bin/omp", "18.16.0")]
        });
        let due = agents.due(&found, false);
        let (after, changed, kept) = agents.record(&due, HashMap::new());
        assert_eq!((after, changed), (found, false));
        assert!(kept.is_empty());
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
