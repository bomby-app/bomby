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

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Semaphore;

use super::connections;
use crate::app_log;
use crate::error::Result;
use crate::local_socket::{self, same};

pub const SOCKET_ENV: &str = "BOMBY_TOKENS";
pub const SECRET_ENV: &str = "BOMBY_TOKENS_SECRET";
/// How long a request may take to arrive; the answer may wait on a refresh.
const READ_TIMEOUT: Duration = Duration::from_secs(5);
/// The most a request may weigh: a secret, an id and a token.
const MAX_REQUEST: u64 = 64 * 1024;
/// The most requests answered at once; more connections are closed unanswered. A call asks
/// for one token per extension at a time, so this is far above real use.
const MAX_AT_ONCE: usize = 16;
/// How long the socket waits before accepting again after an accept failed.
const ACCEPT_RETRY: Duration = Duration::from_millis(100);

/// A token, with its seconds left, or a line for the voice model.
pub type Answer = std::result::Result<(String, Option<i64>), String>;

/// Answers a request for an extension's token: its id and the stale token, if any.
pub type Fetch = Arc<
    dyn Fn(String, Option<String>) -> Pin<Box<dyn Future<Output = Answer> + Send>> + Send + Sync,
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
    /// Listens in a fresh folder under the temp dir, answering with `fetch` on the async
    /// runtime.
    pub fn start(fetch: Fetch) -> Result<Self> {
        Self::start_in(&std::env::temp_dir(), fetch)
    }

    fn start_in(parent: &Path, fetch: Fetch) -> Result<Self> {
        let local_socket::PrivateSocket {
            dir,
            path,
            listener,
        } = local_socket::bind(parent, "bomby", "tokens.sock")?;
        let secret = local_socket::secret()?;
        let expected = secret.clone();
        tauri::async_runtime::spawn(async move {
            match UnixListener::from_std(listener) {
                Ok(listener) => serve(listener, expected, fetch).await,
                Err(e) => eprintln!("token socket: {e}"),
            }
        });
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
        let app = handle.clone();
        Box::pin(async move { connections::fresh_token(&app, &id, stale.as_deref()).await })
    });
    match TokenSocket::start(fetch) {
        Ok(socket) => Some(socket),
        Err(e) => {
            let _ = app_log::append(app, &format!("token socket: {e}"));
            None
        }
    }
}

/// The answer to one request line.
pub async fn answer(line: &str, secret: &str, fetch: &Fetch) -> String {
    let reply = match serde_json::from_str::<Request>(line) {
        Err(_) => serde_json::json!({ "error": "The request wasn't readable." }),
        Ok(request) if !same(&request.secret, secret) => {
            serde_json::json!({ "error": "Not allowed." })
        }
        Ok(request) => match fetch(request.extension, request.stale).await {
            Ok((token, expires_in)) => {
                serde_json::json!({ "token": token, "expires_in": expires_in })
            }
            Err(message) => serde_json::json!({ "error": message }),
        },
    };
    reply.to_string()
}

/// Accepts connections for the run, answering at most `MAX_AT_ONCE` at a time.
async fn serve(listener: UnixListener, secret: String, fetch: Fetch) {
    let permits = Arc::new(Semaphore::new(MAX_AT_ONCE));
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            // Out of file descriptors, say: wait for some to free up rather than spin.
            tokio::time::sleep(ACCEPT_RETRY).await;
            continue;
        };
        // Over the limit: closed unanswered, which the worker reads as the app not answering.
        let Ok(permit) = permits.clone().try_acquire_owned() else {
            continue;
        };
        let (secret, fetch) = (secret.clone(), fetch.clone());
        tauri::async_runtime::spawn(async move {
            let _permit = permit;
            respond(stream, &secret, &fetch).await;
        });
    }
}

/// Reads one request line, within `READ_TIMEOUT`, and writes its answer.
async fn respond(stream: UnixStream, secret: &str, fetch: &Fetch) {
    let (read, mut write) = stream.into_split();
    let mut line = String::new();
    let mut reader = BufReader::new(read.take(MAX_REQUEST));
    let request = reader.read_line(&mut line);
    if !matches!(tokio::time::timeout(READ_TIMEOUT, request).await, Ok(Ok(_))) {
        return;
    }
    let reply = answer(&line, secret, fetch).await;
    let _ = write.write_all(format!("{reply}\n").as_bytes()).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::os::unix::fs::MetadataExt;
    use std::sync::Mutex;

    use tokio::io::AsyncBufReadExt;

    /// Each request the fake grants saw: the extension and the stale token.
    type Seen = Arc<Mutex<Vec<(String, Option<String>)>>>;

    fn fetch(seen: Seen) -> Fetch {
        Arc::new(move |id, stale| {
            seen.lock().unwrap().push((id.clone(), stale));
            Box::pin(async move {
                match id.as_str() {
                    "zapier" => Ok(("tok".into(), Some(300))),
                    _ => Err("Composio isn't connected.".into()),
                }
            })
        })
    }

    #[tokio::test]
    async fn answers_with_the_token_only_for_the_runs_secret() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let f = fetch(seen.clone());
        let ask = async |line: &str| {
            serde_json::from_str::<serde_json::Value>(&answer(line, "s3cret", &f).await).unwrap()
        };
        assert_eq!(
            ask(r#"{"secret":"s3cret","extension":"zapier","stale":"old"}"#).await,
            serde_json::json!({ "token": "tok", "expires_in": 300 })
        );
        assert_eq!(
            seen.lock().unwrap()[0],
            ("zapier".into(), Some("old".into()))
        );
        assert_eq!(
            ask(r#"{"secret":"s3cret","extension":"composio","stale":null}"#).await,
            serde_json::json!({ "error": "Composio isn't connected." })
        );
        assert_eq!(
            ask(r#"{"secret":"guess","extension":"zapier","stale":null}"#).await["error"],
            "Not allowed."
        );
        assert_eq!(
            ask("nonsense").await["error"],
            "The request wasn't readable."
        );
        assert_eq!(
            seen.lock().unwrap().len(),
            2,
            "a wrong secret never reaches the grants"
        );
    }

    #[tokio::test]
    async fn the_socket_is_private_and_answers_over_the_wire() {
        let parent = tempfile_dir("wire");
        let socket =
            TokenSocket::start_in(&parent, fetch(Arc::new(Mutex::new(Vec::new())))).unwrap();
        let [(_, path), (_, secret)] = socket.env();
        assert_eq!(
            std::fs::metadata(&socket.dir).unwrap().mode() & 0o777,
            0o700
        );
        assert_eq!(std::fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        assert!(path.len() <= local_socket::MAX_SOCKET_PATH);

        let mut stream = UnixStream::connect(&path).await.unwrap();
        let request =
            format!("{{\"secret\":\"{secret}\",\"extension\":\"zapier\",\"stale\":null}}\n");
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut reply = String::new();
        BufReader::new(stream).read_line(&mut reply).await.unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&reply).unwrap()["token"],
            "tok"
        );

        socket.stop();
        assert!(!socket.dir.exists());
        let _ = std::fs::remove_dir_all(parent);
    }

    /// A folder of the test's own, short enough for a socket path.
    fn tempfile_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bt-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn a_silent_client_is_dropped_and_others_still_answered() {
        let parent = tempfile_dir("silent");
        let socket =
            TokenSocket::start_in(&parent, fetch(Arc::new(Mutex::new(Vec::new())))).unwrap();
        let [(_, path), (_, secret)] = socket.env();
        // More silent connections than the limit, then a real request.
        let mut silent = Vec::new();
        for _ in 0..MAX_AT_ONCE + 4 {
            silent.push(UnixStream::connect(&path).await.unwrap());
        }
        tokio::time::sleep(READ_TIMEOUT + Duration::from_millis(500)).await;
        let mut stream = UnixStream::connect(&path).await.unwrap();
        let request =
            format!("{{\"secret\":\"{secret}\",\"extension\":\"zapier\",\"stale\":null}}\n");
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut reply = String::new();
        BufReader::new(stream).read_line(&mut reply).await.unwrap();
        assert!(
            reply.contains("tok"),
            "the silent ones timed out and freed their places"
        );
        socket.stop();
        let _ = std::fs::remove_dir_all(parent);
    }
}
