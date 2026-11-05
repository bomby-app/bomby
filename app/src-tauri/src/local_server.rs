//! The LiveKit server on this Mac (docs/decisions/livekit-on-this-mac-or-cloud.md).

use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use crate::credentials::LiveKitKeys;
use crate::error::{Error, Result};
use crate::{process, sync};

const PROGRAM: &str = "livekit-server";
const API_KEY: &str = "bomby";
/// Hex-encoded, so 64 characters: the server rejects secrets under 32.
const SECRET_BYTES: usize = 32;
const READY_TIMEOUT: Duration = Duration::from_secs(10);
const READY_POLL: Duration = Duration::from_millis(50);
/// Short: a SIGTERM just after start never exits (1.13.10), and SIGKILL loses nothing.
const STOP_TIMEOUT: Duration = Duration::from_secs(1);
/// A free port can be taken before the server binds it.
const ATTEMPTS: usize = 2;
const LOG_FILE: &str = "livekit.log";
const PID_FILE: &str = "livekit-server.pid";

struct Running {
    child: Child,
    keys: LiveKitKeys,
}

pub struct LocalServer {
    running: Mutex<Option<Running>>,
    /// Held while a server starts, so `running` is never held that long.
    starting: Mutex<()>,
    /// Bumped by `stop`, so a start it overlapped doesn't keep its server.
    stops: AtomicU64,
    program: PathBuf,
    data_dir: PathBuf,
    log_dir: PathBuf,
}

impl Drop for LocalServer {
    fn drop(&mut self) {
        self.stop();
    }
}

/// tauri-build puts the sidecar next to the app's program, in dev too.
pub fn bundled() -> Result<PathBuf> {
    Ok(std::env::current_exe()?.with_file_name(PROGRAM))
}

impl LocalServer {
    /// Also stops a server a killed run left behind.
    pub fn new(program: PathBuf, data_dir: PathBuf, log_dir: PathBuf) -> Self {
        stop_left_behind(&data_dir.join(PID_FILE), &program);
        Self {
            running: Mutex::new(None),
            starting: Mutex::new(()),
            stops: AtomicU64::new(0),
            program,
            data_dir,
            log_dir,
        }
    }

    pub fn ensure(&self) -> Result<LiveKitKeys> {
        let _starting = sync::lock(&self.starting);
        let dead = {
            let mut slot = sync::lock(&self.running);
            if let Some(running) = slot.as_mut()
                && matches!(running.child.try_wait(), Ok(None))
            {
                return Ok(running.keys.clone());
            }
            slot.take()
        };
        if let Some(old) = dead {
            process::stop_group(old.child, STOP_TIMEOUT);
        }
        let stops = self.stops.load(Ordering::SeqCst);
        let running = self.start()?;
        let mut slot = sync::lock(&self.running);
        if self.stops.load(Ordering::SeqCst) != stops {
            drop(slot);
            process::stop_group(running.child, STOP_TIMEOUT);
            let _ = fs::remove_file(self.data_dir.join(PID_FILE));
            return Err(Error::Invalid(
                "Bomby is stopping its LiveKit server.".into(),
            ));
        }
        let keys = running.keys.clone();
        *slot = Some(running);
        Ok(keys)
    }

    pub fn current(&self) -> Option<LiveKitKeys> {
        sync::lock(&self.running)
            .as_ref()
            .map(|running| running.keys.clone())
    }

    pub fn stop(&self) {
        self.stops.fetch_add(1, Ordering::SeqCst);
        let running = sync::lock(&self.running).take();
        if let Some(running) = running {
            process::stop_group(running.child, STOP_TIMEOUT);
            let _ = fs::remove_file(self.data_dir.join(PID_FILE));
        }
    }

    fn start(&self) -> Result<Running> {
        if !self.program.is_file() {
            return Err(Error::Invalid(
                "This copy of Bomby is missing its LiveKit server. Install Bomby again.".into(),
            ));
        }
        fs::create_dir_all(&self.log_dir)?;
        let log_path = self.log_dir.join(LOG_FILE);
        let mut last = None;
        for _ in 0..ATTEMPTS {
            match self.try_start(&log_path) {
                Ok(running) => return Ok(running),
                Err(e) => last = Some(e),
            }
        }
        Err(last.unwrap_or_else(|| Error::Invalid("The LiveKit server didn't start.".into())))
    }

    fn try_start(&self, log_path: &Path) -> Result<Running> {
        let (signal, media) = free_ports()?;
        let keys = LiveKitKeys {
            url: format!("ws://127.0.0.1:{signal}"),
            api_key: API_KEY.to_owned(),
            api_secret: new_secret()?,
        };
        let log = File::create(log_path)?;
        let mut command = Command::new(&self.program);
        command
            .env("LIVEKIT_CONFIG", config(signal, media))
            .env(
                "LIVEKIT_KEYS",
                format!("{}: {}", keys.api_key, keys.api_secret),
            )
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log);
        #[cfg(unix)]
        std::os::unix::process::CommandExt::process_group(&mut command, 0);

        let mut child = command.spawn()?;
        let _ = fs::write(self.data_dir.join(PID_FILE), child.id().to_string());
        if let Err(why) = wait_until_ready(&mut child, signal) {
            process::stop_group(child, STOP_TIMEOUT);
            let _ = fs::remove_file(self.data_dir.join(PID_FILE));
            let reason = fs::read_to_string(log_path)
                .ok()
                .and_then(|log| last_error(&log))
                .unwrap_or(why);
            return Err(Error::Invalid(format!(
                "The LiveKit server didn't start: {reason}. Its log is in {}.",
                log_path.display()
            )));
        }
        Ok(Running { child, keys })
    }
}

fn free_ports() -> Result<(u16, u16)> {
    let signal = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
    let media = UdpSocket::bind("127.0.0.1:0")?.local_addr()?.port();
    Ok((signal, media))
}

fn new_secret() -> Result<String> {
    let mut bytes = [0u8; SECRET_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|e| Error::Invalid(format!("Couldn't make the LiveKit server's key: {e}")))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// `node_ip` keeps media on loopback; `tcp_port: 0` turns ICE over TCP off.
fn config(signal: u16, media: u16) -> String {
    format!(
        "\
port: {signal}
bind_addresses: [\"127.0.0.1\"]
rtc:
  udp_port: {media}
  tcp_port: 0
  use_external_ip: false
  node_ip: 127.0.0.1
  enable_loopback_candidate: true
  ips:
    includes: [\"127.0.0.1/32\"]
logging:
  json: true
  level: info
"
    )
}

fn wait_until_ready(child: &mut Child, port: u16) -> std::result::Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < READY_TIMEOUT {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("it exited ({status})"));
        }
        if answers_ok(port) {
            return Ok(());
        }
        thread::sleep(READY_POLL);
    }
    Err("it didn't answer in time".into())
}

fn answers_ok(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(READY_POLL * 4));
    let mut answer = String::new();
    stream
        .write_all(b"GET / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
        .and_then(|()| stream.read_to_string(&mut answer))
        .is_ok()
        && answer.starts_with("HTTP/1.")
        && answer.trim_end().ends_with("OK")
}

/// Falls back to the last line: the CLI's own startup errors aren't JSON.
fn last_error(log: &str) -> Option<String> {
    let mut lines = log.lines().rev().filter(|line| !line.trim().is_empty());
    let last = lines.clone().next()?;
    let json = lines.find_map(|line| {
        let entry: serde_json::Value = serde_json::from_str(line).ok()?;
        let level = entry.get("level")?.as_str()?;
        if !matches!(level, "error" | "fatal" | "panic") {
            return None;
        }
        let msg = entry.get("msg")?.as_str()?;
        Some(match entry.get("error").and_then(|e| e.as_str()) {
            Some(error) => format!("{msg}: {error}"),
            None => msg.to_owned(),
        })
    });
    json.or_else(|| {
        serde_json::from_str::<serde_json::Value>(last)
            .is_err()
            .then(|| last.trim().to_owned())
    })
}

/// Checks the pid still runs `program`: pids get reused.
fn stop_left_behind(pid_file: &Path, program: &Path) {
    let Some(pid) = fs::read_to_string(pid_file)
        .ok()
        .and_then(|pid| pid.trim().parse::<i32>().ok())
    else {
        return;
    };
    if is_program(pid, program) {
        stop_group_by_pid(pid);
    }
    let _ = fs::remove_file(pid_file);
}

/// Like `process::stop_group` for a process that isn't our child: SIGTERM, then SIGKILL.
#[cfg(unix)]
fn stop_group_by_pid(pid: i32) {
    // SAFETY: only sends signals; signal 0 only checks the process exists.
    let alive = || unsafe { libc::kill(pid, 0) } == 0;
    unsafe { libc::killpg(pid, libc::SIGTERM) };
    let started = Instant::now();
    while alive() && started.elapsed() < STOP_TIMEOUT {
        thread::sleep(READY_POLL);
    }
    if alive() {
        unsafe { libc::killpg(pid, libc::SIGKILL) };
    }
}

#[cfg(not(unix))]
fn stop_group_by_pid(_pid: i32) {}

#[cfg(target_os = "macos")]
fn is_program(pid: i32, program: &Path) -> bool {
    let mut buffer = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: writes at most `buffer.len()` bytes.
    let len = unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    let Ok(len @ 1..) = usize::try_from(len) else {
        return false;
    };
    let path =
        Path::new(<std::ffi::OsStr as std::os::unix::ffi::OsStrExt>::from_bytes(&buffer[..len]));
    match (fs::canonicalize(path), fs::canonicalize(program)) {
        (Ok(path), Ok(program)) => path == program,
        _ => false,
    }
}

#[cfg(not(target_os = "macos"))]
fn is_program(_pid: i32, _program: &Path) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn built() -> PathBuf {
        let triple = if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        };
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("binaries/{PROGRAM}-{triple}"))
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bomby-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn starts_on_loopback_keeps_running_and_stops() {
        let dir = temp_dir("server");
        let server = LocalServer::new(built(), dir.clone(), dir.clone());
        let keys = server.ensure().unwrap();
        assert!(keys.url.starts_with("ws://127.0.0.1:"), "{}", keys.url);
        assert_eq!(keys.api_secret.len(), SECRET_BYTES * 2);
        assert!(dir.join(PID_FILE).is_file());
        let port: u16 = keys.url.rsplit(':').next().unwrap().parse().unwrap();
        assert!(answers_ok(port));

        assert_eq!(server.ensure().unwrap(), keys);
        assert_eq!(server.current(), Some(keys));

        server.stop();
        assert_eq!(server.current(), None);
        assert!(!answers_ok(port));
        assert!(!dir.join(PID_FILE).exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_next_launch_stops_a_server_a_crashed_run_left() {
        let dir = temp_dir("left");
        let crashed = LocalServer::new(built(), dir.clone(), dir.clone());
        let keys = crashed.ensure().unwrap();
        let port: u16 = keys.url.rsplit(':').next().unwrap().parse().unwrap();
        // A crash never runs Drop.
        std::mem::forget(crashed);

        let _next = LocalServer::new(built(), dir.clone(), dir.clone());

        assert!(!answers_ok(port));
        assert!(!dir.join(PID_FILE).exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn says_when_the_server_is_missing() {
        let dir = temp_dir("missing");
        let server = LocalServer::new(dir.join("nothing"), dir.clone(), dir.clone());
        assert!(
            matches!(server.ensure(), Err(Error::Invalid(m)) if m.contains("missing its LiveKit server"))
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn keeps_the_server_on_loopback() {
        let config = config(41000, 41001);
        for line in [
            "port: 41000",
            "bind_addresses: [\"127.0.0.1\"]",
            "  udp_port: 41001",
            "  tcp_port: 0",
            "  node_ip: 127.0.0.1",
            "    includes: [\"127.0.0.1/32\"]",
            "  json: true",
        ] {
            assert!(config.lines().any(|l| l == line), "missing {line:?}");
        }
    }

    #[test]
    fn makes_a_new_long_secret_each_time() {
        let (a, b) = (new_secret().unwrap(), new_secret().unwrap());
        assert_eq!(a.len(), SECRET_BYTES * 2);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn reads_the_last_error_from_the_log() {
        // As livekit-server 1.13.10 logs, trimmed.
        let log = r#"{"level":"info","msg":"starting LiveKit server","portHttp":7880}
{"level":"error","msg":"could not start server","error":"listen tcp 127.0.0.1:7880: bind: address already in use"}
{"level":"info","msg":"exit requested, shutting down"}
"#;
        assert_eq!(
            last_error(log).as_deref(),
            Some("could not start server: listen tcp 127.0.0.1:7880: bind: address already in use")
        );
        assert_eq!(
            last_error("could not parse config: yaml: line 2\n").as_deref(),
            Some("could not parse config: yaml: line 2")
        );
        assert_eq!(last_error(r#"{"level":"info","msg":"ok"}"#), None);
        assert_eq!(last_error(""), None);
    }

    #[test]
    fn leaves_other_programs_alone() {
        let dir = temp_dir("pid");
        let pid_file = dir.join(PID_FILE);
        let mut other = Command::new("sleep").arg("5").spawn().unwrap();
        fs::write(&pid_file, other.id().to_string()).unwrap();

        stop_left_behind(&pid_file, &built());

        assert!(matches!(other.try_wait(), Ok(None)), "sleep was stopped");
        assert!(!pid_file.exists());
        process::kill(&mut other);
        let _ = fs::remove_dir_all(dir);
    }
}
