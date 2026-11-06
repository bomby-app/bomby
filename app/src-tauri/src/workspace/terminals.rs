//! Terminals in the workspace panel: the user's own login shell, started in one of a
//! project's folders on a pseudo-terminal (portable-pty, from WezTerm). The page draws it
//! (wterm with its Ghostty core): output streams to the page as raw bytes over a channel,
//! and what the user types comes back through `terminal_write`. A terminal lives until the
//! page closes it, its shell exits, or the app quits.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

use super::project_folder;
use crate::app_log;
use crate::db::Db;
use crate::error::{Error, Result};
use crate::sync;

/// How long a closed terminal's shell gets to leave after SIGHUP before SIGKILL.
const HANGUP_GRACE: Duration = Duration::from_secs(1);

type Child = Box<dyn portable_pty::Child + Send + Sync>;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    /// The shell, which leads its own session and process group (portable-pty calls
    /// `setsid`). Only reaped under this lock, so a signal to its group never reaches a
    /// group that reused the number.
    child: Arc<Mutex<Child>>,
}

/// The open terminals, by the id the page holds.
#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    open: Mutex<HashMap<u32, Arc<Mutex<Session>>>>,
}

impl Terminals {
    fn get(&self, id: u32) -> Result<Arc<Mutex<Session>>> {
        sync::lock(&self.open)
            .get(&id)
            .cloned()
            .ok_or(Error::NotFound("terminal"))
    }

    fn close(&self, id: u32) {
        let session = sync::lock(&self.open).remove(&id);
        if let Some(session) = session {
            hang_up(&sync::lock(&session).child);
        }
    }

    /// Closes every terminal, as the app quits.
    pub fn close_all(&self) {
        let sessions: Vec<_> = sync::lock(&self.open).drain().map(|(_, s)| s).collect();
        for session in sessions {
            hang_up(&sync::lock(&session).child);
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

/// The user's login shell, as Terminal.app starts it, in `folder`.
fn shell(folder: &std::path::Path) -> CommandBuilder {
    let program = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut command = CommandBuilder::new(program);
    command.arg("-l");
    command.cwd(folder);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "Bomby");
    // An app opened from Finder has no locale; shells then mangle anything past ASCII.
    if std::env::var_os("LANG").is_none() {
        command.env("LANG", "en_US.UTF-8");
    }
    command
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
        let session = Session {
            master: pair.master,
            writer,
            child: Arc::clone(&child),
        };
        sync::lock(&self.open).insert(id, Arc::new(Mutex::new(session)));

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

/// What the user typed (or pasted) into a terminal.
#[tauri::command(async)]
pub fn terminal_write(terminals: State<'_, TerminalsState>, id: u32, data: String) -> Result<()> {
    let session = terminals.0.get(id)?;
    let mut session = sync::lock(&session);
    session.writer.write_all(data.as_bytes())?;
    session.writer.flush()?;
    Ok(())
}

/// The terminal's new grid, after the panel or window changed size.
#[tauri::command(async)]
pub fn terminal_resize(
    terminals: State<'_, TerminalsState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<()> {
    let session = terminals.0.get(id)?;
    sync::lock(&session)
        .master
        .resize(size(cols, rows))
        .map_err(|e| Error::Invalid(format!("Bomby couldn't resize the terminal: {e}")))
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
        {
            let session = terminals.get(id).unwrap();
            let mut session = sync::lock(&session);
            session.writer.write_all(b"ping\n").unwrap();
            session.writer.flush().unwrap();
        }
        let mut seen = Vec::new();
        while !String::from_utf8_lossy(&seen).contains("ping") {
            seen.extend(output.recv_timeout(WAIT).expect("no echo"));
        }
        terminals.close(id);
        // cat dies of the hang-up: no exit code, but it has gone.
        exit.recv_timeout(WAIT).unwrap();
        assert!(terminals.get(id).is_err());
    }
}
