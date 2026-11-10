//! The Agents panel's live streams: what each coding agent says and does while its turn
//! runs (docs/decisions/agent-streams-through-the-core.md, `agent/acp_client/streams.py`).
//!
//! The worker connects once per call to a Unix socket in a folder only this user can open,
//! with the run's secret (`BOMBY_STREAMS`, `BOMBY_STREAMS_SECRET` in its environment). Its
//! first line is `{"secret": "…", "room": "bomby-<call id>-<ms>"}`; every line after is a
//! [`StreamEvent`]. The core holds a running turn's events in memory, so a panel opened
//! halfway isn't empty, and drops them when the turn ends or the connection closes. The
//! page follows a call with `watch_agent_streams`: the events held, then live ones, over a
//! Tauri `Channel`.
//!
//! Nothing here is written to disk or a log: tool titles can be whole command lines.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Semaphore;

use crate::app_log;
use crate::error::Result;
use crate::local_socket::{self, same};
use crate::sync;

pub const SOCKET_ENV: &str = "BOMBY_STREAMS";
pub const SECRET_ENV: &str = "BOMBY_STREAMS_SECRET";
/// How long the first line may take to arrive.
const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
/// The most a line may weigh. The agent cuts a message at 16,000 characters, which is at
/// most 64 KiB of UTF-8; a longer line closes the connection.
const MAX_LINE: usize = 256 * 1024;
/// The most connections served at once: one per call's job, and the app runs one call.
const MAX_CONNECTIONS: usize = 8;
/// The most streams a call holds at once, one per running turn.
const MAX_STREAMS: usize = 16;
/// About how many bytes a stream holds; beyond it, its oldest events go and a `dropped`
/// marker takes their place.
const STREAM_BUDGET: usize = 1024 * 1024;
/// How long the socket waits before accepting again after an accept failed.
const ACCEPT_RETRY: Duration = Duration::from_millis(100);

/// One event of a running turn's stream: the agent's message text (appended to its
/// message) and its tool calls (patches by id), between the turn's start and end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "agent-streams.ts"))]
pub enum StreamEvent {
    /// A turn started in the call's session `session` of the agent `agent` (a harness id),
    /// called `name` ("Claude").
    Start {
        stream: String,
        agent: String,
        name: String,
        session: String,
    },
    /// Appends to the message `message` (the agent's id for it, if it gave one).
    Text {
        stream: String,
        message: Option<String>,
        text: String,
    },
    /// A tool call's fields that changed; the first one for an id starts it.
    Tool {
        stream: String,
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(test, ts(optional))]
        title: Option<String>,
        /// ACP's kind: read, edit, execute and so on.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(test, ts(optional))]
        kind: Option<String>,
        /// ACP's status: pending, in_progress, completed or failed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(test, ts(optional))]
        status: Option<String>,
    },
    /// Some events before this one were left out: the agent's queue was full, or the
    /// stream outgrew what the core holds.
    Dropped { stream: String },
    /// The turn is over, however it ended; its open tool calls are over with it.
    End { stream: String },
}

impl StreamEvent {
    fn stream(&self) -> &str {
        match self {
            Self::Start { stream, .. }
            | Self::Text { stream, .. }
            | Self::Tool { stream, .. }
            | Self::Dropped { stream }
            | Self::End { stream } => stream,
        }
    }

    /// The same event in the stream `stream`.
    fn in_stream(mut self, id: String) -> Self {
        match &mut self {
            Self::Start { stream, .. }
            | Self::Text { stream, .. }
            | Self::Tool { stream, .. }
            | Self::Dropped { stream }
            | Self::End { stream } => *stream = id,
        }
        self
    }

    /// About what it weighs in memory.
    fn weight(&self) -> usize {
        64 + match self {
            Self::Start {
                agent,
                name,
                session,
                ..
            } => agent.len() + name.len() + session.len(),
            Self::Text { message, text, .. } => {
                message.as_ref().map_or(0, String::len) + text.len()
            }
            Self::Tool {
                id,
                title,
                kind,
                status,
                ..
            } => {
                id.len()
                    + [title, kind, status]
                        .iter()
                        .map(|f| f.as_ref().map_or(0, String::len))
                        .sum::<usize>()
            }
            Self::Dropped { .. } | Self::End { .. } => 0,
        }
    }
}

/// Where a call's events go: false once the page is gone.
pub type Sink = Arc<dyn Fn(&StreamEvent) -> bool + Send + Sync>;

/// A running turn's events, oldest first, the first always its start.
struct Held {
    id: String,
    events: VecDeque<StreamEvent>,
    weight: usize,
}

impl Held {
    fn push(&mut self, event: StreamEvent) {
        // The next piece of the message the last event writes joins it.
        if let (
            Some(StreamEvent::Text { message, text, .. }),
            StreamEvent::Text {
                message: next,
                text: more,
                ..
            },
        ) = (self.events.back_mut(), &event)
            && message == next
        {
            text.push_str(more);
            self.weight += more.len();
        } else {
            self.weight += event.weight();
            self.events.push_back(event);
        }
        // Over budget, the oldest after the start go, and a marker says so.
        while self.weight > STREAM_BUDGET && self.events.len() > 2 {
            if !matches!(self.events.get(1), Some(StreamEvent::Dropped { .. })) {
                let dropped = StreamEvent::Dropped {
                    stream: self.id.clone(),
                };
                self.weight += dropped.weight();
                self.events.insert(1, dropped);
            }
            if let Some(gone) = self.events.remove(2) {
                self.weight -= gone.weight();
            }
        }
    }
}

#[derive(Default)]
struct Call {
    streams: Vec<Held>,
    watchers: HashMap<u64, Sink>,
}

/// Every call's running streams and who watches them. Tauri state.
#[derive(Default)]
pub struct Streams {
    calls: Mutex<HashMap<i64, Call>>,
    next_watch: AtomicU64,
}

impl Streams {
    /// Takes one event of call `call_id`'s, keeps it while its turn runs, and passes it to
    /// the call's watchers. An event of a stream that isn't running is ignored.
    pub fn apply(&self, call_id: i64, event: StreamEvent) {
        let mut calls = sync::lock(&self.calls);
        let call = calls.entry(call_id).or_default();
        let index = call.streams.iter().position(|s| s.id == event.stream());
        match (&event, index) {
            (StreamEvent::Start { .. }, None) if call.streams.len() < MAX_STREAMS => {
                let mut held = Held {
                    id: event.stream().to_owned(),
                    events: VecDeque::new(),
                    weight: 0,
                };
                held.push(event.clone());
                call.streams.push(held);
            }
            (StreamEvent::Start { .. }, _) | (_, None) => {
                Self::tidy(&mut calls, call_id);
                return;
            }
            (StreamEvent::End { .. }, Some(i)) => {
                call.streams.remove(i);
            }
            (_, Some(i)) => call.streams[i].push(event.clone()),
        }
        call.watchers.retain(|_, sink| sink(&event));
        Self::tidy(&mut calls, call_id);
    }

    /// Ends every stream of call `call_id` whose id starts with `prefix`: its connection
    /// closed.
    pub fn end_all(&self, call_id: i64, prefix: &str) {
        let ids: Vec<String> = sync::lock(&self.calls)
            .get(&call_id)
            .map(|call| {
                call.streams
                    .iter()
                    .filter(|s| s.id.starts_with(prefix))
                    .map(|s| s.id.clone())
                    .collect()
            })
            .unwrap_or_default();
        for stream in ids {
            self.apply(call_id, StreamEvent::End { stream });
        }
    }

    /// Sends `sink` call `call_id`'s running streams as they are so far, then each event as
    /// it comes. Returns the id `unwatch` stops it with.
    pub fn watch(&self, call_id: i64, sink: Sink) -> u64 {
        let id = self.next_watch.fetch_add(1, Ordering::Relaxed);
        let mut calls = sync::lock(&self.calls);
        let call = calls.entry(call_id).or_default();
        let shown = call
            .streams
            .iter()
            .flat_map(|s| s.events.iter())
            .all(|event| sink(event));
        if shown {
            call.watchers.insert(id, sink);
        }
        Self::tidy(&mut calls, call_id);
        id
    }

    pub fn unwatch(&self, id: u64) {
        let mut calls = sync::lock(&self.calls);
        for call in calls.values_mut() {
            call.watchers.remove(&id);
        }
        calls.retain(|_, call| !call.streams.is_empty() || !call.watchers.is_empty());
    }

    /// A call with nothing running and no one watching goes.
    fn tidy(calls: &mut HashMap<i64, Call>, call_id: i64) {
        if calls
            .get(&call_id)
            .is_some_and(|c| c.streams.is_empty() && c.watchers.is_empty())
        {
            calls.remove(&call_id);
        }
    }

    #[cfg(test)]
    fn held(&self, call_id: i64) -> Vec<StreamEvent> {
        sync::lock(&self.calls)
            .get(&call_id)
            .map_or(Vec::new(), |c| {
                c.streams.iter().flat_map(|s| s.events.clone()).collect()
            })
    }
}

/// The call a room is for: `bomby-<call id>-<ms>` (`room_name` in calls.rs).
fn call_of(room: &str) -> Option<i64> {
    let rest = room.strip_prefix("bomby-")?;
    let (id, ms) = rest.split_once('-')?;
    ms.parse::<u64>().ok()?;
    id.parse().ok()
}

#[derive(Deserialize)]
struct Hello {
    secret: String,
    room: String,
}

/// The streams and the socket the worker sends them to. Tauri state.
pub struct AgentStreams {
    pub streams: Arc<Streams>,
    pub socket: Option<StreamSocket>,
}

/// The socket, listening for the run.
pub struct StreamSocket {
    dir: PathBuf,
    path: PathBuf,
    secret: String,
}

impl StreamSocket {
    fn start_in(parent: &Path, streams: Arc<Streams>) -> Result<Self> {
        let local_socket::PrivateSocket {
            dir,
            path,
            listener,
        } = local_socket::bind(parent, "bomby-streams", "s.sock")?;
        let secret = local_socket::secret()?;
        let expected = secret.clone();
        tauri::async_runtime::spawn(async move {
            match UnixListener::from_std(listener) {
                Ok(listener) => serve(listener, expected, streams).await,
                Err(e) => eprintln!("agent streams socket: {e}"),
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

/// The streams and their socket for the app; without the socket, calls don't stream.
pub fn start<R: Runtime>(app: &AppHandle<R>) -> AgentStreams {
    let streams = Arc::new(Streams::default());
    let socket = match StreamSocket::start_in(&std::env::temp_dir(), streams.clone()) {
        Ok(socket) => Some(socket),
        Err(e) => {
            let _ = app_log::append(app, &format!("agent streams socket: {e}"));
            None
        }
    };
    AgentStreams { streams, socket }
}

async fn serve(listener: UnixListener, secret: String, streams: Arc<Streams>) {
    let permits = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    let next = AtomicU64::new(1);
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            tokio::time::sleep(ACCEPT_RETRY).await;
            continue;
        };
        let Ok(permit) = permits.clone().try_acquire_owned() else {
            continue;
        };
        let (secret, streams) = (secret.clone(), streams.clone());
        let connection = next.fetch_add(1, Ordering::Relaxed);
        tauri::async_runtime::spawn(async move {
            let _permit = permit;
            receive(stream, &secret, &streams, connection).await;
        });
    }
}

/// Reads one connection: its hello within `HELLO_TIMEOUT`, then events until it closes,
/// which ends the streams it started.
async fn receive(stream: UnixStream, secret: &str, streams: &Streams, connection: u64) {
    let mut reader = BufReader::new(stream);
    let hello = tokio::time::timeout(HELLO_TIMEOUT, read_line(&mut reader)).await;
    let Ok(Some(hello)) = hello else { return };
    let Ok(hello) = serde_json::from_slice::<Hello>(&hello) else {
        return;
    };
    if !same(&hello.secret, secret) {
        return;
    }
    let Some(call_id) = call_of(&hello.room) else {
        return;
    };
    // Each connection's streams apart from another's, as a resumed call's new room is.
    let prefix = format!("{connection}-");
    while let Some(line) = read_line(&mut reader).await {
        // A line the core can't read is skipped: the page shows less, the call goes on.
        if let Ok(event) = serde_json::from_slice::<StreamEvent>(&line) {
            let id = format!("{prefix}{}", event.stream());
            streams.apply(call_id, event.in_stream(id));
        }
    }
    streams.end_all(call_id, &prefix);
}

/// The next line without its newline, or None at the end or past `MAX_LINE`.
async fn read_line(reader: &mut (impl AsyncBufRead + Unpin)) -> Option<Vec<u8>> {
    let mut line = Vec::new();
    loop {
        let buffer = reader.fill_buf().await.ok()?;
        if buffer.is_empty() {
            return None;
        }
        let (taken, done) = match buffer.iter().position(|&b| b == b'\n') {
            Some(at) => (at + 1, true),
            None => (buffer.len(), false),
        };
        line.extend_from_slice(&buffer[..taken]);
        reader.consume(taken);
        if line.len() > MAX_LINE + 1 {
            return None;
        }
        if done {
            line.pop();
            return Some(line);
        }
    }
}

/// Follows the running streams of call `call_id`: those so far, then each event as it
/// comes. Returns the id `unwatch_agent_streams` stops it with.
#[tauri::command(async)]
pub fn watch_agent_streams(
    state: State<'_, AgentStreams>,
    call_id: i64,
    events: Channel<StreamEvent>,
) -> u64 {
    state.streams.watch(
        call_id,
        Arc::new(move |event| events.send(event.clone()).is_ok()),
    )
}

/// Stops following; stopping one that's gone is fine.
#[tauri::command(async)]
pub fn unwatch_agent_streams(state: State<'_, AgentStreams>, id: u64) {
    state.streams.unwatch(id);
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::os::unix::fs::MetadataExt;

    use tokio::io::AsyncWriteExt;

    fn start(stream: &str) -> StreamEvent {
        StreamEvent::Start {
            stream: stream.into(),
            agent: "claude".into(),
            name: "Claude".into(),
            session: "main".into(),
        }
    }

    fn text(stream: &str, text: &str) -> StreamEvent {
        StreamEvent::Text {
            stream: stream.into(),
            message: Some("m1".into()),
            text: text.into(),
        }
    }

    fn end(stream: &str) -> StreamEvent {
        StreamEvent::End {
            stream: stream.into(),
        }
    }

    /// A watcher that keeps what it's sent.
    fn recorder() -> (Sink, Arc<Mutex<Vec<StreamEvent>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let kept = seen.clone();
        (
            Arc::new(move |e: &StreamEvent| {
                kept.lock().unwrap().push(e.clone());
                true
            }),
            seen,
        )
    }

    #[test]
    fn a_running_turn_is_held_and_dropped_when_it_ends() {
        let streams = Streams::default();
        streams.apply(1, start("a"));
        streams.apply(1, text("a", "Hel"));
        streams.apply(1, text("a", "lo"));
        // A panel opened now sees it so far, the message's pieces as one.
        let (sink, seen) = recorder();
        streams.watch(1, sink);
        assert_eq!(*seen.lock().unwrap(), vec![start("a"), text("a", "Hello")]);
        streams.apply(1, end("a"));
        assert_eq!(seen.lock().unwrap().last(), Some(&end("a")));
        assert!(streams.held(1).is_empty(), "nothing is kept after the turn");
        // An event of a turn that's over is ignored.
        streams.apply(1, text("a", "late"));
        assert_eq!(seen.lock().unwrap().len(), 3);
    }

    #[test]
    fn a_closed_connection_ends_its_streams_only() {
        let streams = Streams::default();
        streams.apply(1, start("1-a"));
        streams.apply(1, start("2-a"));
        let (sink, seen) = recorder();
        streams.watch(1, sink);
        streams.end_all(1, "1-");
        assert_eq!(seen.lock().unwrap().last(), Some(&end("1-a")));
        assert_eq!(streams.held(1), vec![start("2-a")]);
    }

    #[test]
    fn a_stream_past_its_budget_drops_its_oldest_events_and_says_so() {
        let streams = Streams::default();
        streams.apply(1, start("a"));
        let big = "x".repeat(STREAM_BUDGET / 4);
        for n in 0..10 {
            streams.apply(
                1,
                StreamEvent::Tool {
                    stream: "a".into(),
                    id: format!("t{n}"),
                    title: Some(big.clone()),
                    kind: None,
                    status: None,
                },
            );
        }
        let held = streams.held(1);
        assert_eq!(held[0], start("a"));
        assert_eq!(held[1], StreamEvent::Dropped { stream: "a".into() });
        assert!(held.len() < 8);
        assert!(matches!(&held.last().unwrap(), StreamEvent::Tool { id, .. } if id == "t9"));
    }

    #[test]
    fn a_page_that_went_away_stops_being_sent_to() {
        let streams = Streams::default();
        streams.apply(1, start("a"));
        streams.watch(1, Arc::new(|_| false));
        streams.apply(1, end("a"));
        assert!(sync::lock(&streams.calls).is_empty());
    }

    #[test]
    fn rooms_name_their_call() {
        assert_eq!(call_of("bomby-12-1731000000000"), Some(12));
        assert_eq!(call_of("bomby-12"), None);
        assert_eq!(call_of("other-12-1"), None);
    }

    fn short_dir(name: &str) -> PathBuf {
        let dir = Path::new("/tmp").join(format!("bs-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    async fn until(done: impl Fn() -> bool) {
        for _ in 0..200 {
            if done() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("never happened");
    }

    #[tokio::test]
    async fn the_socket_is_private_and_takes_events_only_with_the_secret() {
        let parent = short_dir("wire");
        let streams = Arc::new(Streams::default());
        let socket = StreamSocket::start_in(&parent, streams.clone()).unwrap();
        let [(_, path), (_, secret)] = socket.env();
        assert_eq!(
            std::fs::metadata(&socket.dir).unwrap().mode() & 0o777,
            0o700
        );
        assert_eq!(std::fs::metadata(&path).unwrap().mode() & 0o777, 0o600);

        // A wrong secret: nothing is taken.
        let mut wrong = UnixStream::connect(&path).await.unwrap();
        wrong
            .write_all(b"{\"secret\":\"guess\",\"room\":\"bomby-3-1\"}\n")
            .await
            .unwrap();
        wrong
            .write_all(b"{\"type\":\"start\",\"stream\":\"1\",\"agent\":\"x\",\"name\":\"X\",\"session\":\"y\"}\n")
            .await
            .unwrap();

        let mut right = UnixStream::connect(&path).await.unwrap();
        let hello = format!("{{\"secret\":\"{secret}\",\"room\":\"bomby-3-1\"}}\n");
        right.write_all(hello.as_bytes()).await.unwrap();
        right
            .write_all(
                b"{\"type\":\"start\",\"stream\":\"1\",\"agent\":\"codex\",\"name\":\"Codex\",\"session\":\"api\"}\nnot json\n{\"type\":\"tool\",\"stream\":\"1\",\"id\":\"t1\",\"title\":\"Run ls\",\"status\":\"in_progress\"}\n",
            )
            .await
            .unwrap();
        until(|| streams.held(3).len() == 2).await;
        let held = streams.held(3);
        assert!(
            matches!(&held[0], StreamEvent::Start { stream, agent, .. } if agent == "codex" && stream.ends_with("-1"))
        );

        // Closing the connection ends its streams.
        drop(right);
        until(|| streams.held(3).is_empty()).await;

        // A line past the limit closes the connection, ending what it started.
        let mut long = UnixStream::connect(&path).await.unwrap();
        long.write_all(hello.as_bytes()).await.unwrap();
        long.write_all(
            b"{\"type\":\"start\",\"stream\":\"1\",\"agent\":\"codex\",\"name\":\"Codex\",\"session\":\"api\"}\n",
        )
        .await
        .unwrap();
        until(|| streams.held(3).len() == 1).await;
        long.write_all(&vec![b'x'; MAX_LINE + 10]).await.unwrap();
        until(|| streams.held(3).is_empty()).await;

        socket.stop();
        assert!(!socket.dir.exists());
        let _ = std::fs::remove_dir_all(parent);
    }
}
