//! The token socket: where the worker gets the hosted MCP extensions' access tokens during
//! a call (docs/decisions/hosted-mcp-extensions-with-oauth.md, `agent/extensions/tokens.py`).
//!
//! A Unix socket in a folder only this user can open, with a random secret for the run; the
//! worker gets both in its environment (`BOMBY_TOKENS`, `BOMBY_TOKENS_SECRET`). Each
//! connection is one request and one answer, each a line of JSON:
//!
//! ```text
//! → {"secret": "…", "extension": "zapier", "stale": "<the token it has, or null>"}
//! ← {"token": "…", "expires_in": 3600}   or   {"error": "a line for the voice model"}
//! ```
//!
//! Tokens never go to the page or through LiveKit.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Deserialize;
use tauri::{AppHandle, Runtime};

use super::connections;
use crate::app_log;
use crate::error::{Error, Result};

pub const SOCKET_ENV: &str = "BOMBY_TOKENS";
pub const SECRET_ENV: &str = "BOMBY_TOKENS_SECRET";
/// How long a request may take to arrive; the answer may wait on a refresh.
const READ_TIMEOUT: Duration = Duration::from_secs(5);
/// The most a request may weigh: a secret, an id and a token.
const MAX_REQUEST: u64 = 64 * 1024;
/// A Unix socket's path is limited to 104 bytes on macOS (`sun_path`).
const MAX_SOCKET_PATH: usize = 100;

/// Answers a request for an extension's token: its id and the stale token, if any.
pub type Fetch = Arc<
    dyn Fn(&str, Option<&str>) -> std::result::Result<(String, Option<i64>), String> + Send + Sync,
>;

#[derive(Deserialize)]
struct Request {
    secret: String,
    extension: String,
    stale: Option<String>,
}

/// The app's socket, or None when it couldn't start: calls then get no token, and their
/// hosted MCP extensions load no tools. Tauri state.
pub struct Tokens(pub Option<TokenSocket>);

/// The socket, listening for the run.
pub struct TokenSocket {
    dir: PathBuf,
    path: PathBuf,
    secret: String,
}

impl TokenSocket {
    /// Listens in a fresh folder under the temp dir, answering with `fetch`.
    pub fn start(fetch: Fetch) -> Result<Self> {
        Self::start_in(&std::env::temp_dir(), fetch)
    }

    fn start_in(parent: &Path, fetch: Fetch) -> Result<Self> {
        let mut dir = parent.join(format!("bomby-{}", std::process::id()));
        if dir.join("tokens.sock").as_os_str().len() > MAX_SOCKET_PATH {
            dir = Path::new("/tmp").join(format!("bomby-{}", std::process::id()));
        }
        // A folder left by an earlier run with this pid goes; then only this user may enter.
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::DirBuilder::new().mode(0o700).create(&dir)?;
        let path = dir.join("tokens.sock");
        let listener = UnixListener::bind(&path)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes)
            .map_err(|e| Error::Invalid(format!("Couldn't make the token secret: {e}")))?;
        let secret = URL_SAFE_NO_PAD.encode(bytes);
        let expected = secret.clone();
        thread::Builder::new()
            .name("token-socket".into())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    let (fetch, expected) = (fetch.clone(), expected.clone());
                    let _ = thread::Builder::new()
                        .name("token-request".into())
                        .spawn(move || serve(stream, &expected, &fetch));
                }
            })?;
        Ok(Self { dir, path, secret })
    }

    /// What the worker's environment gets.
    pub fn env(&self) -> [(&'static str, String); 2] {
        [
            (SOCKET_ENV, self.path.to_string_lossy().into_owned()),
            (SECRET_ENV, self.secret.clone()),
        ]
    }

    /// Removes the folder, socket and all. Called when the app exits.
    pub fn stop(&self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// The socket for the app, answering from the keychain's grants (`connections::fresh_token`).
pub fn start<R: Runtime>(app: &AppHandle<R>) -> Option<TokenSocket> {
    let handle = app.clone();
    let fetch: Fetch = Arc::new(move |id, stale| {
        tauri::async_runtime::block_on(connections::fresh_token(&handle, id, stale))
    });
    match TokenSocket::start(fetch) {
        Ok(socket) => Some(socket),
        Err(e) => {
            let _ = app_log::append(app, &format!("token socket: {e}"));
            None
        }
    }
}

/// Compares in time that doesn't depend on where they differ.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

/// The answer to one request line.
pub fn answer(line: &str, secret: &str, fetch: &Fetch) -> String {
    let reply = match serde_json::from_str::<Request>(line) {
        Err(_) => serde_json::json!({ "error": "The request wasn't readable." }),
        Ok(request) if !same(&request.secret, secret) => {
            serde_json::json!({ "error": "Not allowed." })
        }
        Ok(request) => match fetch(&request.extension, request.stale.as_deref()) {
            Ok((token, expires_in)) => {
                serde_json::json!({ "token": token, "expires_in": expires_in })
            }
            Err(message) => serde_json::json!({ "error": message }),
        },
    };
    reply.to_string()
}

fn serve(stream: UnixStream, secret: &str, fetch: &Fetch) {
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let Ok(reader) = stream.try_clone() else {
        return;
    };
    let mut line = String::new();
    if BufReader::new(reader.take(MAX_REQUEST))
        .read_line(&mut line)
        .is_err()
    {
        return;
    }
    let mut stream = stream;
    let _ = writeln!(stream, "{}", answer(&line, secret, fetch));
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::os::unix::fs::MetadataExt;
    use std::sync::Mutex;

    /// Each request the fake grants saw: the extension and the stale token.
    type Seen = Arc<Mutex<Vec<(String, Option<String>)>>>;

    fn fetch(seen: Seen) -> Fetch {
        Arc::new(move |id, stale| {
            seen.lock()
                .unwrap()
                .push((id.to_owned(), stale.map(str::to_owned)));
            match id {
                "zapier" => Ok(("tok".into(), Some(300))),
                _ => Err("Composio isn't connected.".into()),
            }
        })
    }

    #[test]
    fn answers_with_the_token_only_for_the_runs_secret() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let f = fetch(seen.clone());
        let ask = |line: &str| {
            serde_json::from_str::<serde_json::Value>(&answer(line, "s3cret", &f)).unwrap()
        };
        assert_eq!(
            ask(r#"{"secret":"s3cret","extension":"zapier","stale":"old"}"#),
            serde_json::json!({ "token": "tok", "expires_in": 300 })
        );
        assert_eq!(
            seen.lock().unwrap()[0],
            ("zapier".into(), Some("old".into()))
        );
        assert_eq!(
            ask(r#"{"secret":"s3cret","extension":"composio","stale":null}"#),
            serde_json::json!({ "error": "Composio isn't connected." })
        );
        assert_eq!(
            ask(r#"{"secret":"guess","extension":"zapier","stale":null}"#)["error"],
            "Not allowed."
        );
        assert_eq!(ask("nonsense")["error"], "The request wasn't readable.");
        assert_eq!(
            seen.lock().unwrap().len(),
            2,
            "a wrong secret never reaches the grants"
        );
    }

    #[test]
    fn the_socket_is_private_and_answers_over_the_wire() {
        let parent = tempfile_dir();
        let socket =
            TokenSocket::start_in(&parent, fetch(Arc::new(Mutex::new(Vec::new())))).unwrap();
        let [(_, path), (_, secret)] = socket.env();
        assert_eq!(
            std::fs::metadata(&socket.dir).unwrap().mode() & 0o777,
            0o700
        );
        assert_eq!(std::fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        assert!(path.len() <= MAX_SOCKET_PATH);

        let mut stream = UnixStream::connect(&path).unwrap();
        writeln!(
            stream,
            r#"{{"secret":"{secret}","extension":"zapier","stale":null}}"#
        )
        .unwrap();
        let mut reply = String::new();
        BufReader::new(stream).read_line(&mut reply).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&reply).unwrap()["token"],
            "tok"
        );

        socket.stop();
        assert!(!socket.dir.exists());
        let _ = std::fs::remove_dir_all(parent);
    }

    fn tempfile_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bomby-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
