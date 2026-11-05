//! Waiting on the programs the core runs (agents' `--version`, adapter installs, the voice
//! agent). std has no `Child::wait_timeout` as of Rust 1.99, so this polls `try_wait`.

use std::io;
use std::process::{Child, ExitStatus};
use std::thread;
use std::time::{Duration, Instant};

const TICK: Duration = Duration::from_millis(50);

/// Waits up to `timeout` for `child` to exit: its status, or `None` if it's still running.
pub fn wait_timeout(child: &mut Child, timeout: Duration) -> io::Result<Option<ExitStatus>> {
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(Some(status));
        }
        if started.elapsed() >= timeout {
            return Ok(None);
        }
        thread::sleep(TICK);
    }
}

/// For a child started with `process_group(0)`: SIGTERM to its group, SIGKILL after `grace`.
pub fn stop_group(mut child: Child, grace: Duration) {
    #[cfg(unix)]
    if let Ok(pid) = i32::try_from(child.id()) {
        // SAFETY: killpg only sends a signal; the group is the one the child leads.
        unsafe { libc::killpg(pid, libc::SIGTERM) };
        if let Ok(Some(_)) = wait_timeout(&mut child, grace) {
            return;
        }
        unsafe { libc::killpg(pid, libc::SIGKILL) };
    }
    kill(&mut child);
}

/// Kills `child` and reaps it, so it leaves no zombie.
pub fn kill(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    #[test]
    fn returns_the_status_of_a_program_that_exits() {
        let mut child = Command::new("true").spawn().unwrap();
        let status = wait_timeout(&mut child, Duration::from_secs(5)).unwrap();
        assert!(status.is_some_and(|s| s.success()));
    }

    #[test]
    fn gives_up_on_a_program_that_keeps_running() {
        let mut child = Command::new("sleep").arg("5").spawn().unwrap();
        let status = wait_timeout(&mut child, Duration::from_millis(100)).unwrap();
        assert!(status.is_none());
        kill(&mut child);
    }
}
