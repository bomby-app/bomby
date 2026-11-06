//! Terminals in the workspace panel: the user's own login shell, started in one of a
//! project's folders on a pseudo-terminal (portable-pty, from WezTerm). The page draws it
//! (wterm with its Ghostty core): output streams to the page as raw bytes over a channel,
//! and what the user types comes back through `terminal_write`. A terminal lives until the
//! page closes it, its shell exits, or the app quits.
//!
//! Tauri runs each command as its own task on a thread pool, so two keystrokes' commands
//! can overtake each other. The page numbers everything it sends a terminal (typing and
//! resizes alike); the terminal's [`Inbox`] puts it back in that order, and one writer
//! thread per terminal hands it to the shell, so a full pseudo-terminal buffer never
//! blocks a command.

use std::collections::{BTreeMap, HashMap};
use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Deserialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

use super::project_folder;
use crate::app_log;
use crate::db::Db;
use crate::error::{Error, Result};
use crate::sync;

/// How long a closed terminal's shell gets to leave after SIGHUP before SIGKILL.
const HANGUP_GRACE: Duration = Duration::from_secs(1);

/// Inputs that may arrive ahead of one still missing. Past this many, the missing one is
/// taken as lost (its command failed on the page) and the rest go on without it.
const MAX_EARLY: usize = 1024;

type Child = Box<dyn portable_pty::Child + Send + Sync>;

/// Something the page sends a terminal.
enum Input {
    Bytes(Vec<u8>),
    Resize(PtySize),
}

/// Puts the page's inputs back in the order it numbered them (from 0) before the writer
/// thread gets them.
struct Inbox {
    next: u64,
    early: BTreeMap<u64, Input>,
    writer: mpsc::Sender<Input>,
}

impl Inbox {
    fn take(&mut self, seq: u64, input: Input) {
        if seq < self.next {
            return;
        }
        self.early.insert(seq, input);
        if self.early.len() > MAX_EARLY
            && let Some(&first) = self.early.keys().next()
        {
            self.next = first;
        }
        while let Some(input) = self.early.remove(&self.next) {
            // The writer has stopped only when its shell's terminal has gone.
            let _ = self.writer.send(input);
            self.next += 1;
        }
    }
}

struct Session {
    inbox: Mutex<Inbox>,
    /// The shell, which leads its own session and process group (portable-pty calls
    /// `setsid`). Only reaped under this lock, so a signal to its group never reaches a
    /// group that reused the number.
    child: Arc<Mutex<Child>>,
}

/// The open terminals, by the id the page holds.
#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    open: Mutex<HashMap<u32, Arc<Session>>>,
}

impl Terminals {
    fn get(&self, id: u32) -> Result<Arc<Session>> {
        sync::lock(&self.open)
            .get(&id)
            .cloned()
            .ok_or(Error::NotFound("terminal"))
    }

    /// Input number `seq` for terminal `id`, applied once every earlier one has been.
    fn send(&self, id: u32, seq: u64, input: Input) -> Result<()> {
        sync::lock(&self.get(id)?.inbox).take(seq, input);
        Ok(())
    }

    /// Forgets the terminal, which stops its writer and closes our end of it once the
    /// last command using it is done, and hangs up its shell.
    fn close(&self, id: u32) {
        let session = sync::lock(&self.open).remove(&id);
        if let Some(session) = session {
            hang_up(&session.child);
        }
    }

    /// Closes every terminal, as the app quits.
    pub fn close_all(&self) {
        let sessions: Vec<_> = sync::lock(&self.open).drain().map(|(_, s)| s).collect();
        for session in sessions {
            hang_up(&session.child);
        }
    }
}

/// Hands the inputs to the shell's terminal in order, until the terminal is closed (its
/// inbox dropped) or the shell's side is gone. Owns our end of the terminal.
fn write_all_inputs(
    inputs: mpsc::Receiver<Input>,
    mut writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
) {
    for input in inputs {
        match input {
            Input::Bytes(bytes) => {
                if writer
                    .write_all(&bytes)
                    .and_then(|()| writer.flush())
                    .is_err()
                {
                    break;
                }
            }
            // A failed resize leaves the old size; the next one tries again.
            Input::Resize(size) => {
                let _ = master.resize(size);
            }
        }
    }
}

/// Signals the shell's process group, while the shell hasn't been reaped.
fn signal(child: &Mutex<Child>, signal: i32) {
    let mut child = sync::lock(child);
    if !matches!(child.try_wait(), Ok(None)) {
        return;
    }
    #[cfg(unix)]
    if let Some(pid) = child.process_id().and_then(|p| i32::try_from(p).ok()) {
        // SAFETY: killpg only sends a signal; the group is the one the running shell leads.
        unsafe { libc::killpg(pid, signal) };
    }
}

/// SIGHUP to the shell's process group, as closing a terminal window does, then SIGKILL
/// for whatever ignored it.
fn hang_up(child: &Arc<Mutex<Child>>) {
    signal(child, libc::SIGHUP);
    let child = Arc::clone(child);
    thread::spawn(move || {
        thread::sleep(HANGUP_GRACE);
        signal(&child, libc::SIGKILL);
    });
}

/// Waits for the shell to exit and reaps it: its exit code, `None` if it can't be read.
fn reap(child: &Mutex<Child>) -> Option<u32> {
    loop {
        match sync::lock(child).try_wait() {
            Ok(Some(status)) => return Some(status.exit_code()),
            Ok(None) => {}
            Err(_) => return None,
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// What the shell's environment keeps from the app's own: what a terminal app opened from
/// Finder hands its shell (launchd's session), plus the locale. Everything else the login
/// shell sets up itself from the user's profile. Passing the app's whole environment would
/// hand on whatever the shell that started it had (`EDITOR=nvim` under `just app dev`,
/// which switches zsh to vi keys before the user's zshrc runs, so Delete typed "~").
const PASSED: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "SSH_AUTH_SOCK",
    "__CF_USER_TEXT_ENCODING",
    "LANG",
];

/// The PATH launchd gives apps; the login shell adds the rest (`/etc/zprofile`'s
/// path_helper, then the user's own files).
const SYSTEM_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

/// The shell's environment, from the app's (`parent`).
fn terminal_env(
    parent: impl IntoIterator<Item = (OsString, OsString)>,
) -> Vec<(OsString, OsString)> {
    let mut env: Vec<_> = parent
        .into_iter()
        .filter(|(name, _)| {
            name.to_str()
                .is_some_and(|n| PASSED.contains(&n) || n.starts_with("LC_"))
        })
        .collect();
    let mut set = |name: &str, value: &str| {
        env.retain(|(n, _)| n != name);
        env.push((name.into(), value.into()));
    };
    set("PATH", SYSTEM_PATH);
    set("TERM", "xterm-256color");
    set("COLORTERM", "truecolor");
    set("TERM_PROGRAM", "Bomby");
    // An app opened from Finder has no locale; shells then mangle anything past ASCII.
    if !env.iter().any(|(n, _)| n == "LANG") {
        env.push(("LANG".into(), "en_US.UTF-8".into()));
    }
    env
}

/// `program` in `folder` with exactly `env`.
fn command_in(
    program: &OsStr,
    args: &[&str],
    folder: &Path,
    env: Vec<(OsString, OsString)>,
) -> CommandBuilder {
    let mut command = CommandBuilder::new(program);
    command.args(args);
    command.cwd(folder);
    command.env_clear();
    for (name, value) in env {
        command.env(name, value);
    }
    command
}

/// The user's login shell in `folder`, as a terminal app starts it.
fn shell(folder: &Path) -> CommandBuilder {
    let env = terminal_env(std::env::vars_os());
    let program = env
        .iter()
        .find(|(n, _)| n == "SHELL")
        .map_or_else(|| OsString::from("/bin/zsh"), |(_, v)| v.clone());
    command_in(&program, &["-l"], folder, env)
}

fn pty_error(e: impl std::fmt::Display) -> Error {
    Error::Invalid(format!("pseudo-terminal: {e}"))
}

impl Terminals {
    /// Runs `command` on a new pseudo-terminal of `cols` by `rows`. `output` gets each
    /// chunk it writes, and returns false once nobody listens; `exited` gets its exit
    /// code once it has gone. Returns the terminal's id.
    fn spawn(
        self: &Arc<Self>,
        command: CommandBuilder,
        cols: u16,
        rows: u16,
        mut output: impl FnMut(&[u8]) -> bool + Send + 'static,
        exited: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> Result<u32> {
        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(pty_error)?;
        let child = pair.slave.spawn_command(command).map_err(pty_error)?;
        // Only the shell holds the terminal's other end now, so its exit ends our reads.
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(pty_error)?;
        let writer = pair.master.take_writer().map_err(pty_error)?;

        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let child = Arc::new(Mutex::new(child));
        let (inputs, received) = mpsc::channel();
        let master = pair.master;
        thread::spawn(move || write_all_inputs(received, writer, master));
        let session = Session {
            inbox: Mutex::new(Inbox {
                next: 0,
                early: BTreeMap::new(),
                writer: inputs,
            }),
            child: Arc::clone(&child),
        };
        sync::lock(&self.open).insert(id, Arc::new(session));

        let terminals = Arc::clone(self);
        thread::spawn(move || {
            let mut buffer = vec![0; 64 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    // macOS reports EIO once the shell is gone.
                    Ok(0) | Err(_) => break,
                    Ok(n) if !output(&buffer[..n]) => break,
                    Ok(_) => {}
                }
            }
            // The shell is gone, or the page that showed it is: either way it's closed.
            terminals.close(id);
            exited(reap(&child));
        });
        Ok(id)
    }
}

/// The open terminals, in Tauri state.
#[derive(Default)]
pub struct TerminalsState(pub Arc<Terminals>);

/// Starts a shell in one of a project's folders. Its output arrives on `output` as raw
/// bytes; `exit` gets the shell's exit code (or `null`) once it has gone.
#[tauri::command(async)]
#[expect(
    clippy::too_many_arguments,
    reason = "a command's arguments are what the page sends plus the state it needs"
)]
pub fn terminal_open(
    app: AppHandle,
    db: State<'_, Db>,
    terminals: State<'_, TerminalsState>,
    project_id: i64,
    folder: String,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
    exit: Channel<Option<u32>>,
) -> Result<u32> {
    let folder = project_folder(&db.conn(), project_id, &folder)?;
    terminals
        .0
        .spawn(
            shell(&folder),
            cols,
            rows,
            move |chunk| output.send(InvokeResponseBody::Raw(chunk.to_vec())).is_ok(),
            move |code| {
                let _ = exit.send(code);
            },
        )
        .map_err(|e| {
            let _ = app_log::append(&app, &format!("terminal didn't start: {e}"));
            Error::Invalid("Bomby couldn't start a terminal. Try again?".into())
        })
}

/// Text the user typed or pasted, or raw bytes (mouse reports past ASCII).
#[derive(Deserialize)]
#[serde(untagged)]
pub enum TerminalData {
    Text(String),
    Bytes(Vec<u8>),
}

/// What the user typed (or pasted) into a terminal: input number `seq`, counted from 0
/// with the terminal's resizes.
#[tauri::command(async)]
pub fn terminal_write(
    terminals: State<'_, TerminalsState>,
    id: u32,
    seq: u64,
    data: TerminalData,
) -> Result<()> {
    let bytes = match data {
        TerminalData::Text(text) => text.into_bytes(),
        TerminalData::Bytes(bytes) => bytes,
    };
    terminals.0.send(id, seq, Input::Bytes(bytes))
}

/// The terminal's new grid, after the panel or window changed size: input number `seq`.
#[tauri::command(async)]
pub fn terminal_resize(
    terminals: State<'_, TerminalsState>,
    id: u32,
    seq: u64,
    cols: u16,
    rows: u16,
) -> Result<()> {
    terminals.0.send(id, seq, Input::Resize(size(cols, rows)))
}

/// Closes a terminal and hangs up its shell. Closing one that's gone is fine.
#[tauri::command(async)]
pub fn terminal_close(terminals: State<'_, TerminalsState>, id: u32) {
    terminals.0.close(id);
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use super::*;

    fn command(program: &str, args: &[&str]) -> CommandBuilder {
        let mut command = CommandBuilder::new(program);
        command.args(args);
        command
    }

    /// Runs `command` in a terminal, collecting its output until it exits.
    fn run(
        terminals: &Arc<Terminals>,
        command: CommandBuilder,
    ) -> (u32, mpsc::Receiver<Vec<u8>>, mpsc::Receiver<Option<u32>>) {
        let (out_tx, out_rx) = mpsc::channel();
        let (exit_tx, exit_rx) = mpsc::channel();
        let id = terminals
            .spawn(
                command,
                80,
                24,
                move |chunk| out_tx.send(chunk.to_vec()).is_ok(),
                move |code| exit_tx.send(code).unwrap(),
            )
            .unwrap();
        (id, out_rx, exit_rx)
    }

    fn text(output: &mpsc::Receiver<Vec<u8>>) -> String {
        String::from_utf8_lossy(&output.try_iter().flatten().collect::<Vec<_>>()).into_owned()
    }

    const WAIT: Duration = Duration::from_secs(5);

    #[test]
    fn streams_output_and_reports_the_exit_code() {
        let terminals = Arc::new(Terminals::default());
        let (id, output, exit) = run(
            &terminals,
            command("/bin/sh", &["-c", "echo hello; exit 3"]),
        );
        assert_eq!(exit.recv_timeout(WAIT).unwrap(), Some(3));
        assert!(text(&output).contains("hello"));
        // Gone from the open terminals once its program exits.
        assert!(terminals.get(id).is_err());
    }

    #[test]
    fn typing_reaches_the_program_and_closing_hangs_it_up() {
        let terminals = Arc::new(Terminals::default());
        let (id, output, exit) = run(&terminals, command("/bin/cat", &[]));
        terminals
            .send(id, 0, Input::Bytes(b"ping\n".to_vec()))
            .unwrap();
        let mut seen = Vec::new();
        while !String::from_utf8_lossy(&seen).contains("ping") {
            seen.extend(output.recv_timeout(WAIT).expect("no echo"));
        }
        terminals.close(id);
        // cat dies of the hang-up: no exit code, but it has gone.
        exit.recv_timeout(WAIT).unwrap();
        assert!(terminals.get(id).is_err());
    }

    /// Keystrokes sent the way the page sends them: one command each, numbered, which
    /// Tauri runs as its own task on its thread pool (`#[tauri::command(async)]`), so they
    /// can overtake each other. Without the numbers they arrived scrambled ("0,6,12,18,2").
    #[test]
    fn keystrokes_arrive_in_the_order_they_were_typed() {
        let terminals = Arc::new(Terminals::default());
        let (id, output, _exit) = run(&terminals, command("/bin/sh", &["-c", "stty -echo; cat"]));
        // Under the 1024-byte line the terminal's line editing holds on macOS.
        let typed: Vec<String> = (0..150).map(|n| format!("{n},")).collect();
        let tasks: Vec<_> = (0_u64..)
            .zip(typed.iter().cloned())
            .map(|(seq, key)| {
                let terminals = Arc::clone(&terminals);
                tauri::async_runtime::spawn(async move {
                    terminals
                        .send(id, seq, Input::Bytes(key.into_bytes()))
                        .unwrap();
                })
            })
            .collect();
        for task in tasks {
            tauri::async_runtime::block_on(task).unwrap();
        }
        terminals
            .send(id, 150, Input::Bytes(b"\n".to_vec()))
            .unwrap();
        let mut seen = Vec::new();
        while !String::from_utf8_lossy(&seen).contains('\n') {
            seen.extend(output.recv_timeout(WAIT).expect("no output"));
        }
        terminals.close(id);
        assert_eq!(String::from_utf8_lossy(&seen).trim(), typed.concat());
    }

    #[test]
    fn the_inbox_waits_for_a_missing_input_and_drops_repeats() {
        let (writer, inputs) = mpsc::channel();
        let mut inbox = Inbox {
            next: 0,
            early: BTreeMap::new(),
            writer,
        };
        let bytes = |s: &str| Input::Bytes(s.as_bytes().to_vec());
        inbox.take(1, bytes("b"));
        assert!(inputs.try_recv().is_err());
        inbox.take(0, bytes("a"));
        inbox.take(0, bytes("again"));
        inbox.take(2, Input::Resize(size(10, 5)));
        let got: Vec<String> = inputs
            .try_iter()
            .map(|input| match input {
                Input::Bytes(b) => String::from_utf8(b).unwrap(),
                Input::Resize(s) => format!("{}x{}", s.cols, s.rows),
            })
            .collect();
        assert_eq!(got, ["a", "b", "10x5"]);
    }

    #[test]
    fn a_lost_input_stops_holding_up_the_rest() {
        let (writer, inputs) = mpsc::channel();
        let mut inbox = Inbox {
            next: 0,
            early: BTreeMap::new(),
            writer,
        };
        // Number 0 never comes.
        for seq in 1..=u64::try_from(MAX_EARLY).unwrap() + 1 {
            inbox.take(seq, Input::Bytes(vec![b'x']));
        }
        assert_eq!(inputs.try_iter().count(), MAX_EARLY + 1);
    }

    #[test]
    fn the_shell_gets_a_terminal_apps_environment_not_the_apps() {
        let parent = [
            ("HOME", "/Users/me"),
            ("SHELL", "/bin/zsh"),
            ("LC_CTYPE", "UTF-8"),
            ("PATH", "/Users/me/.local/bin:/usr/bin"),
            ("EDITOR", "nvim"),
            ("BOMBY_DEV_AGENTS", "codex"),
            ("TERM", "dumb"),
        ]
        .map(|(n, v)| (OsString::from(n), OsString::from(v)));
        let env = terminal_env(parent);
        let get = |name: &str| {
            env.iter()
                .find(|(n, _)| n == name)
                .map(|(_, v)| v.to_str().unwrap())
        };
        assert_eq!(get("HOME"), Some("/Users/me"));
        assert_eq!(get("LC_CTYPE"), Some("UTF-8"));
        assert_eq!(get("PATH"), Some(SYSTEM_PATH));
        assert_eq!(get("TERM"), Some("xterm-256color"));
        assert_eq!(get("LANG"), Some("en_US.UTF-8"));
        assert_eq!(get("EDITOR"), None);
        assert_eq!(get("BOMBY_DEV_AGENTS"), None);
    }

    /// What Delete does in an interactive login zsh started with `env`, whose zshrc
    /// (in a folder of its own, not the user's) only picks emacs keys, as many do.
    #[cfg(target_os = "macos")]
    fn delete_key_in_zsh(mut env: Vec<(OsString, OsString)>) -> String {
        let dir = crate::workspace::tests::tempfile_dir(&format!("zsh-{}", env.len()));
        std::fs::write(dir.join(".zshrc"), "bindkey -e\n").unwrap();
        env.push(("ZDOTDIR".into(), dir.clone().into()));
        let terminals = Arc::new(Terminals::default());
        let command = command_in(
            OsStr::new("/bin/zsh"),
            &["-lic", "bindkey '^[[3~'"],
            &dir,
            env,
        );
        let (_id, output, exit) = run(&terminals, command);
        exit.recv_timeout(WAIT).expect("zsh didn't finish");
        text(&output)
    }

    /// The bug the owner saw: with the app's own environment (here, `EDITOR=nvim`, as
    /// `just app dev` has), zsh starts in vi keys, macOS's /etc/zshrc binds Delete there,
    /// and the zshrc's `bindkey -e` leaves it unbound, so it types "~".
    #[cfg(target_os = "macos")]
    #[test]
    fn delete_deletes_in_the_users_shell() {
        let parent = || {
            [
                ("HOME", "/Users/me"),
                ("EDITOR", "nvim"),
                ("TERM", "xterm-256color"),
            ]
            .map(|(n, v)| (OsString::from(n), OsString::from(v)))
            .to_vec()
        };
        let leaked = delete_key_in_zsh(parent());
        assert!(!leaked.contains("delete-char"), "{leaked}");
        let clean = delete_key_in_zsh(terminal_env(parent()));
        assert!(clean.contains("delete-char"), "{clean}");
    }
}
