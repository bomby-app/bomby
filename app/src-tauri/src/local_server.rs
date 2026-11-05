//! The LiveKit server Bomby runs on this Mac, when calls use it instead of the user's own
//! (docs/decisions/livekit-on-this-mac-or-cloud.md): LiveKit's open-source `livekit-server`,
//! built by `just livekit build` and bundled as a sidecar next to this program.
//!
//! The core starts it with the first call that needs it and keeps it for the app's lifetime,
//! like the agent worker. It's on this machine only: the signal port is on 127.0.0.1, and the
//! media port advertises only loopback. Each start gets new free ports and new keys, made
//! here and kept in memory: its config and keys reach it through its environment, never
//! disk. Its output goes to `livekit.log` in the app's log folder.
//!
//! Unlike the agent, it can't watch the app's pipe, so a killed app would leave it running.
//! Its pid goes in `livekit-server.pid` in the app data folder, and the next launch stops
//! that process if it is still this server.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use crate::credentials::LiveKitKeys;
use crate::error::{Error, Result};
use crate::{process, sync};

/// The sidecar's name next to this program (`bundle.externalBin` in tauri.conf.json; also in
/// dev, where tauri-build copies it into target/).
const PROGRAM: &str = "livekit-server";
/// The API key; the secret is what's random.
const API_KEY: &str = "bomby";
/// Random bytes in the secret, written as hex: 64 characters, over the server's minimum of 32.
const SECRET_BYTES: usize = 32;
/// How long a fresh server gets to answer. It takes about 0.15 s.
const READY_TIMEOUT: Duration = Duration::from_secs(10);
const READY_POLL: Duration = Duration::from_millis(50);
/// How long the server gets to exit after SIGTERM before SIGKILL. It exits in about 40 ms,
/// but not at all when the signal lands within milliseconds of its start (1.13.10;
/// docs/livekit-notes.md#the-bundled-server). It keeps nothing on disk, so killing it loses
/// nothing.
const STOP_TIMEOUT: Duration = Duration::from_secs(1);
/// Starts tried, each with new ports, in case another program takes a port first.
const ATTEMPTS: usize = 2;
const LOG_FILE: &str = "livekit.log";
const PID_FILE: &str = "livekit-server.pid";

struct Running {
    child: Child,
    keys: LiveKitKeys,
}

/// The server, shared through Tauri state.
pub struct LocalServer {
    running: Mutex<Option<Running>>,
    /// The `livekit-server` program (`bundled`).
    program: PathBuf,
    /// Where its pid file goes: the app data folder.
    data_dir: PathBuf,
    log_dir: PathBuf,
}

/// The bundled server, next to this program.
pub fn bundled() -> Result<PathBuf> {
    Ok(std::env::current_exe()?.with_file_name(PROGRAM))
}

impl LocalServer {
    /// Stops a server an earlier, killed run left behind, if there is one.
    pub fn new(program: PathBuf, data_dir: PathBuf, log_dir: PathBuf) -> Self {
        stop_left_behind(&data_dir.join(PID_FILE), &program);
        Self {
            running: Mutex::new(None),
            program,
            data_dir,
            log_dir,
        }
    }

    /// Makes sure the server runs, starting it if it isn't or it died, and says how to reach
    /// it: its URL and this start's keys.
    pub fn ensure(&self) -> Result<LiveKitKeys> {
        let mut slot = sync::lock(&self.running);
        if let Some(running) = slot.as_mut()
            && matches!(running.child.try_wait(), Ok(None))
        {
            return Ok(running.keys.clone());
        }
        if let Some(old) = slot.take() {
            process::stop_group(old.child, STOP_TIMEOUT);
        }
        let running = self.start()?;
        let keys = running.keys.clone();
        *slot = Some(running);
        Ok(keys)
    }

    /// How to reach the server if it runs, without starting it.
    pub fn current(&self) -> Option<LiveKitKeys> {
        sync::lock(&self.running)
            .as_ref()
            .map(|running| running.keys.clone())
    }

    /// Stops the server, if one runs: when the app exits, and when calls move to the user's
    /// own LiveKit.
    pub fn stop(&self) {
        if let Some(running) = sync::lock(&self.running).take() {
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
        // Its own process group, so stopping it stops anything it starts too.
        #[cfg(unix)]
        std::os::unix::process::CommandExt::process_group(&mut command, 0);

        let mut child = command.spawn()?;
        let _ = fs::write(self.data_dir.join(PID_FILE), child.id().to_string());
        if let Err(why) = wait_until_ready(&mut child, signal) {
            process::stop_group(child, STOP_TIMEOUT);
            let _ = fs::remove_file(self.data_dir.join(PID_FILE));
            // What the server said, if anything, says more than how it failed.
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

/// A free TCP port for signalling and a free UDP port for media, on loopback. They're free
/// when asked for; another program could take one before the server binds it, which a new
/// attempt covers.
fn free_ports() -> Result<(u16, u16)> {
    let signal = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
    let media = UdpSocket::bind("127.0.0.1:0")?.local_addr()?.port();
    Ok((signal, media))
}

/// 32 random bytes from the OS, as hex.
fn new_secret() -> Result<String> {
    let mut bytes = [0u8; SECRET_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|e| Error::Invalid(format!("Couldn't make the LiveKit server's key: {e}")))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// The server's config (livekit-server 1.13.10, `pkg/config/config.go` and
/// mediatransportutil's `rtcconfig`; docs/livekit-notes.md#the-bundled-server). Everything on
/// loopback: signalling bound to 127.0.0.1, media muxed on one UDP port that advertises only
/// 127.0.0.1, and no ICE over TCP (port 0 turns it off). JSON logs, for `last_error`.
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

/// Waits for `GET /` on the signal port to answer `OK`. A server that exits first or never
/// answers fails, saying which.
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

/// The last error in the server's log, in one line: a JSON line at level `error` or `fatal`
/// (its `msg`, and its `error` when it has one), or the CLI's own last line, which isn't JSON
/// (a config it couldn't read, say).
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

/// Stops the server whose pid `pid_file` holds, if it's still running and still `program`
/// (a pid can be reused), then forgets the file.
fn stop_left_behind(pid_file: &Path, program: &Path) {
    let Some(pid) = fs::read_to_string(pid_file)
        .ok()
        .and_then(|pid| pid.trim().parse::<i32>().ok())
    else {
        return;
    };
    if is_program(pid, program) {
        // SAFETY: only sends a signal, to a process checked to be our server. It led its own
        // group, so the group goes too.
        #[cfg(unix)]
        unsafe {
            libc::killpg(pid, libc::SIGTERM)
        };
    }
    let _ = fs::remove_file(pid_file);
}

/// Whether process `pid` runs `program`.
#[cfg(target_os = "macos")]
fn is_program(pid: i32, program: &Path) -> bool {
    let mut buffer = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: proc_pidpath writes at most `buffer.len()` bytes into the buffer.
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

/// Elsewhere there's no cheap check, so nothing left behind is stopped.
#[cfg(not(target_os = "macos"))]
fn is_program(_pid: i32, _program: &Path) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The server `just livekit build` built for this machine, which the app bundles.
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

        // Running already: the same server and keys.
        assert_eq!(server.ensure().unwrap(), keys);
        assert_eq!(server.current(), Some(keys));

        server.stop();
        assert_eq!(server.current(), None);
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
