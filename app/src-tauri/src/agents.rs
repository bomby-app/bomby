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
//! [`Agents`]. Each look also probes the installed agents' setup. Settings shows what is
//! kept and looks again on Check again; each call looks up the programs again before it
//! opens.

use std::collections::HashMap;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::error::Result;
use crate::process;
use crate::setup::{self, Setup};
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
        id: "codex",
        name: "Codex",
        binary: "codex",
        places: &[
            "~/.local/bin/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex",
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
    /// `None` when the probe couldn't run.
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
    if let Ok(Some(_)) = process::wait_timeout(&mut child, timeout) {
        return child.wait_with_output().ok();
    }
    process::kill(&mut child);
    None
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

/// Every known agent with its status and setup. The probe and each agent's own checks run
/// side by side, so a look takes about as long as the shell and the slowest of them.
fn detect_all(previous: &HashMap<String, PathBuf>) -> Vec<AgentStatus> {
    let found = find_all(previous);
    let installed = programs(found.clone());
    thread::scope(|scope| {
        let probe = scope.spawn(|| setup::probe(&installed).unwrap_or_default());
        let checks: Vec<_> = found
            .into_iter()
            .map(|(known, path)| (known, scope.spawn(move || status_of(known, path))))
            .collect();
        let mut agents: Vec<_> = checks
            .into_iter()
            .map(|(known, check)| check.join().unwrap_or_else(|_| status_of(known, None)))
            .collect();
        let setups = probe.join().unwrap_or_default();
        for agent in &mut agents {
            agent.setup = setups.get(agent.id).cloned();
        }
        agents
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
}

impl Agents {
    fn lock(&self) -> MutexGuard<'_, Detection> {
        sync::lock(&self.state)
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
            Ok(found) => {
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

/// The installed ones among `agents` a call can use: all but those the probe found not set
/// up. One not probed yet stays, so a probe that can't run never hides an agent.
pub fn usable(agents: &[AgentStatus]) -> Vec<(String, PathBuf)> {
    let ready: Vec<_> = agents
        .iter()
        .filter(|a| a.setup.as_ref().is_none_or(|s| s.ready))
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
    let previous: HashMap<_, _> = installed(&shown).into_iter().collect();
    let found = programs(find_all(&previous));
    if installed(&shown) != found {
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
    let (found, changed) = app.state::<Agents>().detect(seen);
    if changed {
        // Only fails for an invalid event name or payload; a window that misses it still
        // gets the list when it asks.
        let _ = app.emit(CHANGED, &found);
    }
    found
}

/// [`refresh`] after something on disk changed (adapters installed), for callers already on
/// a blocking thread. The answer comes from a look that starts now: one already running
/// began before the change, so it may miss it (an empty `seen` asks for that, as a call's
/// news does).
pub fn refresh_after_change<R: Runtime>(app: &AppHandle<R>) {
    refresh(app, Some(Vec::new()));
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
    fn a_change_on_disk_waits_for_the_running_look_then_looks_again() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::mpsc;

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
            ready: true,
            problem: None,
            fix: None,
            account: None,
            model: Some(model.into()),
            adapter: None,
        }
    }

    fn needs_setup() -> Setup {
        Setup {
            ready: false,
            problem: Some("No model is set".into()),
            fix: None,
            account: None,
            model: None,
            adapter: None,
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
}
