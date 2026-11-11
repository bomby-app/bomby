//! The Agents panel's live streams: what each coding agent says and does while its turn
//! runs (docs/decisions/agent-streams-through-the-core.md, `agent/acp_client/streams.py`).
//!
//! The worker connects once per call to a Unix socket in a folder only this user can open,
//! with the run's secret (`BOMBY_STREAMS`, `BOMBY_STREAMS_SECRET` in its environment). Its
//! first line is `{"secret": "…", "room": "bomby-<call id>-<ms>"}`; every line after is a
//! [`StreamEvent`]. The core holds the call's turns in memory, the finished ones too, so a
//! panel opened at any point in the call shows all of it, and drops them when the call
//! ends (its connection closes). The page follows a call with `watch_agent_streams`: the
//! events held, then live ones, over a Tauri `Channel`.
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
use crate::db::now_ms;
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
/// The most bytes of one message a stream holds: what the agent's cut comes to at most, so
/// only a worker that let more through reaches it. Text past it is left out, and a
/// `dropped` marker says so.
const MAX_TEXT: usize = 64 * 1024;
/// The most connections served at once: one per call's job, and the app runs one call.
const MAX_CONNECTIONS: usize = 8;
/// The most turns a call has running at once.
const MAX_STREAMS: usize = 16;
/// About how many bytes a stream holds; beyond it, its oldest events go and a `dropped`
/// marker takes their place.
const STREAM_BUDGET: usize = 1024 * 1024;
/// About how many bytes, and how many turns, a call holds in all; beyond either, its oldest
/// finished turns go.
const CALL_BUDGET: usize = 8 * 1024 * 1024;
const MAX_HELD: usize = 256;
/// How long the socket waits before accepting again after an accept failed.
const ACCEPT_RETRY: Duration = Duration::from_millis(100);

/// One event of a turn's stream: the agent's message text (appended to its message) and
/// its tool calls (patches by id), between the turn's start and end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "agent-streams.ts"))]
pub enum StreamEvent {
    /// A turn started in the call's session `session` of the agent `agent` (a harness id),
    /// called `name` ("Claude"). `at` is when the core got it, in ms since 1970: the worker
    /// doesn't send one.
    Start {
        stream: String,
        agent: String,
        name: String,
        session: String,
        #[serde(default)]
        at: i64,
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
    /// Some events before this one were left out: the agent's queue was full, the stream
    /// outgrew what the core holds, or a message did.
    Dropped { stream: String },
    /// The turn is over; its open tool calls are over with it. `outcome` is how the worker
    /// says it ended (`done`, `stopped` or `failed`), and missing when the core ended it
    /// itself, its connection having closed. `at` as in `Start`.
    End {
        stream: String,
        #[serde(default)]
        at: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(test, ts(optional))]
        outcome: Option<String>,
    },
}

impl StreamEvent {
    fn stream(&self) -> &str {
        match self {
            Self::Start { stream, .. }
            | Self::Text { stream, .. }
            | Self::Tool { stream, .. }
            | Self::Dropped { stream }
            | Self::End { stream, .. } => stream,
        }
    }

    /// The same event in the stream `stream`.
    fn in_stream(mut self, id: String) -> Self {
        match &mut self {
            Self::Start { stream, .. }
            | Self::Text { stream, .. }
            | Self::Tool { stream, .. }
            | Self::Dropped { stream }
            | Self::End { stream, .. } => *stream = id,
        }
        self
    }

    /// The same event, a start or an end marked as got at `now`.
    fn got_at(mut self, now: i64) -> Self {
        if let Self::Start { at, .. } | Self::End { at, .. } = &mut self {
            *at = now;
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

/// A turn's events, oldest first, the first always its start and, once it's over, the
/// last its end.
struct Held {
    id: String,
    events: VecDeque<StreamEvent>,
    weight: usize,
    ended: bool,
    /// The message the last event wrote to, and how many of its bytes were taken; none
    /// once anything but text came after it.
    writing: Option<(Option<String>, usize)>,
}

impl Held {
    /// Takes `event`, and returns what of it is held, for the watchers: all of it, or, of
    /// text that takes its message past `MAX_TEXT`, the part that fits and one `Dropped`.
    /// The joined text is bounded here because the budget's trim can't be what bounds it:
    /// a stream that is its start and one message has nothing older to let go.
    fn push(&mut self, event: StreamEvent) -> Vec<StreamEvent> {
        let StreamEvent::Text {
            stream,
            message,
            mut text,
        } = event
        else {
            self.writing = None;
            self.hold(event.clone());
            return vec![event];
        };
        // An empty piece is nothing to hold, and so no other message either: counted as
        // one, it would hand the message before it a fresh allowance to join past the cap.
        if text.is_empty() {
            return Vec::new();
        }
        let taken = match &self.writing {
            Some((written, taken)) if *written == message => *taken,
            _ => 0,
        };
        let fits = text.floor_char_boundary(MAX_TEXT - taken);
        let cut = fits < text.len();
        // Once cut, the message is full: nothing shorter slips in after the marker.
        self.writing = Some((message.clone(), if cut { MAX_TEXT } else { taken + fits }));
        text.truncate(fits);
        let mut held = Vec::new();
        if !text.is_empty() {
            held.push(StreamEvent::Text {
                stream,
                message,
                text,
            });
        }
        if cut && !matches!(self.events.back(), Some(StreamEvent::Dropped { .. })) {
            held.push(StreamEvent::Dropped {
                stream: self.id.clone(),
            });
        }
        for event in &held {
            self.hold(event.clone());
        }
        held
    }

    fn hold(&mut self, event: StreamEvent) {
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
    /// In the order their turns started.
    streams: Vec<Held>,
    watchers: HashMap<u64, Sink>,
}

impl Call {
    /// Over what a call may hold, its oldest finished turns go. A page already watching
    /// keeps what it was sent; one that opens later starts after them.
    fn trim(&mut self) {
        let weight = |streams: &[Held]| streams.iter().map(|s| s.weight).sum::<usize>();
        while weight(&self.streams) > CALL_BUDGET || self.streams.len() > MAX_HELD {
            let Some(oldest) = self.streams.iter().position(|s| s.ended) else {
                return;
            };
            self.streams.remove(oldest);
        }
    }
}

/// Every call's streams and who watches them. Tauri state.
#[derive(Default)]
pub struct Streams {
    calls: Mutex<HashMap<i64, Call>>,
    next_watch: AtomicU64,
}

impl Streams {
    /// Takes one event of call `call_id`'s, keeps it for the rest of the call, and passes
    /// it to the call's watchers. An event of a turn that never started, or is over, is
    /// ignored.
    pub fn apply(&self, call_id: i64, event: StreamEvent) {
        let mut calls = sync::lock(&self.calls);
        let call = calls.entry(call_id).or_default();
        let index = call.streams.iter().position(|s| s.id == event.stream());
        let running = call.streams.iter().filter(|s| !s.ended).count();
        let started = matches!(event, StreamEvent::Start { .. });
        let ending = matches!(event, StreamEvent::End { .. });
        // What the stream held of it, which is what the watchers get.
        let sent = match index {
            None if started && running < MAX_STREAMS => {
                let mut held = Held {
                    id: event.stream().to_owned(),
                    events: VecDeque::new(),
                    weight: 0,
                    ended: false,
                    writing: None,
                };
                let sent = held.push(event);
                call.streams.push(held);
                sent
            }
            Some(i) if !started && !call.streams[i].ended => {
                call.streams[i].ended = ending;
                call.streams[i].push(event)
            }
            // A turn that never started or is over, a second start, or one start too many.
            _ => {
                Self::tidy(&mut calls, call_id);
                return;
            }
        };
        call.trim();
        call.watchers
            .retain(|_, sink| sent.iter().all(|event| sink(event)));
        Self::tidy(&mut calls, call_id);
    }

    /// The connection that sent call `call_id`'s streams whose ids start with `prefix`
    /// closed, so the call is over: its running turns end, for whoever watches, and
    /// everything it sent goes.
    pub fn end_all(&self, call_id: i64, prefix: &str) {
        let running: Vec<String> = sync::lock(&self.calls)
            .get(&call_id)
            .map(|call| {
                call.streams
                    .iter()
                    .filter(|s| !s.ended && s.id.starts_with(prefix))
                    .map(|s| s.id.clone())
                    .collect()
            })
            .unwrap_or_default();
        for stream in running {
            // How its turn ended isn't known: the worker went before it could say.
            let (at, outcome) = (now_ms(), None);
            self.apply(
                call_id,
                StreamEvent::End {
                    stream,
                    at,
                    outcome,
                },
            );
        }
        let mut calls = sync::lock(&self.calls);
        if let Some(call) = calls.get_mut(&call_id) {
            call.streams.retain(|s| !s.id.starts_with(prefix));
        }
        Self::tidy(&mut calls, call_id);
    }

    /// Sends `sink` call `call_id`'s streams as they are so far, the finished turns too,
    /// then each event as it comes. Returns the id `unwatch` stops it with.
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

    /// A call with nothing held and no one watching goes.
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
/// which is the call ending: what it sent is dropped.
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
            streams.apply(call_id, event.in_stream(id).got_at(now_ms()));
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

/// Follows the streams of call `call_id`: its turns so far, finished or running, then each
/// event as it comes. Returns the id `unwatch_agent_streams` stops it with.
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
            at: 0,
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
            at: 0,
            outcome: None,
        }
    }

    /// The events without when the core got them.
    fn unstamped(events: &[StreamEvent]) -> Vec<StreamEvent> {
        events.iter().map(|e| e.clone().got_at(0)).collect()
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
    fn a_turn_is_held_after_it_ends_until_the_call_does() {
        let streams = Streams::default();
        streams.apply(1, start("1-a"));
        streams.apply(1, text("1-a", "Hel"));
        streams.apply(1, text("1-a", "lo"));
        // A panel opened now sees it so far, the message's pieces as one.
        let (sink, seen) = recorder();
        streams.watch(1, sink);
        assert_eq!(
            *seen.lock().unwrap(),
            vec![start("1-a"), text("1-a", "Hello")]
        );
        streams.apply(1, end("1-a"));
        assert_eq!(seen.lock().unwrap().last(), Some(&end("1-a")));
        // An event of a turn that's over is ignored.
        streams.apply(1, text("1-a", "late"));
        assert_eq!(seen.lock().unwrap().len(), 3);
        // The session's next turn comes after it, and a panel opened later gets both.
        streams.apply(1, start("1-b"));
        let (late, replayed) = recorder();
        streams.watch(1, late);
        assert_eq!(
            *replayed.lock().unwrap(),
            vec![start("1-a"), text("1-a", "Hello"), end("1-a"), start("1-b")]
        );
        // The call ends: the running turn ends for who watches, and nothing is kept.
        streams.end_all(1, "1-");
        assert_eq!(
            unstamped(&replayed.lock().unwrap()).last(),
            Some(&end("1-b"))
        );
        assert!(streams.held(1).is_empty(), "nothing is kept after the call");
    }

    #[test]
    fn a_closed_connection_drops_its_turns_only() {
        let streams = Streams::default();
        streams.apply(1, start("1-a"));
        streams.apply(1, end("1-a"));
        streams.apply(1, start("1-b"));
        streams.apply(1, start("2-a"));
        let (sink, seen) = recorder();
        streams.watch(1, sink);
        streams.end_all(1, "1-");
        assert_eq!(unstamped(&seen.lock().unwrap()).last(), Some(&end("1-b")));
        assert_eq!(streams.held(1), vec![start("2-a")]);
    }

    #[test]
    fn a_call_past_what_it_may_hold_lets_its_oldest_finished_turns_go() {
        let streams = Streams::default();
        streams.apply(1, start("running"));
        for n in 0..MAX_HELD + 3 {
            let id = format!("t{n}");
            streams.apply(1, start(&id));
            streams.apply(1, end(&id));
        }
        let held = streams.held(1);
        let started: Vec<&str> = held
            .iter()
            .filter(|e| matches!(e, StreamEvent::Start { .. }))
            .map(StreamEvent::stream)
            .collect();
        assert_eq!(started.len(), MAX_HELD);
        // The one still running stays, however old; the oldest finished ones went.
        assert_eq!(started[0], "running");
        assert_eq!(started[1], "t4");
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
    fn a_message_that_keeps_growing_is_cut_at_its_cap_and_says_so() {
        // Its start and one message: nothing older for the budget's trim to let go (#40).
        let streams = Streams::default();
        streams.apply(1, start("a"));
        let (sink, seen) = recorder();
        streams.watch(1, sink);
        // An odd byte, then two-byte characters: the cap falls inside one.
        streams.apply(1, text("a", "x"));
        let piece = "é".repeat(MAX_TEXT / 8);
        for _ in 0..8 {
            streams.apply(1, text("a", &piece));
        }
        let held = streams.held(1);
        let dropped = StreamEvent::Dropped { stream: "a".into() };
        assert_eq!(held.len(), 3, "its start, the message and one marker");
        let StreamEvent::Text { text: kept, .. } = &held[1] else {
            panic!("the message is held: {:?}", held[1]);
        };
        assert_eq!(
            kept.len(),
            MAX_TEXT - 1,
            "cut before the character that didn't fit"
        );
        assert_eq!(held[2], dropped);
        // The page watching got as much, not what was left out.
        let seen = seen.lock().unwrap().clone();
        let sent: String = seen
            .iter()
            .filter_map(|e| match e {
                StreamEvent::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(&sent, kept);
        assert_eq!(seen.iter().filter(|e| **e == dropped).count(), 1);
        // Its next message starts afresh.
        let next = StreamEvent::Text {
            stream: "a".into(),
            message: Some("m2".into()),
            text: "next".into(),
        };
        streams.apply(1, next.clone());
        assert_eq!(streams.held(1).last(), Some(&next));
    }

    #[test]
    fn an_empty_piece_of_another_message_gives_no_fresh_allowance() {
        // It isn't held, so what follows under the first id still joins that message.
        let streams = Streams::default();
        streams.apply(1, start("a"));
        let (sink, seen) = recorder();
        streams.watch(1, sink);
        let empty = StreamEvent::Text {
            stream: "a".into(),
            message: Some("m2".into()),
            text: String::new(),
        };
        let piece = "x".repeat(MAX_TEXT / 4);
        for _ in 0..80 {
            streams.apply(1, text("a", &piece));
            streams.apply(1, empty.clone());
        }
        let dropped = StreamEvent::Dropped { stream: "a".into() };
        assert_eq!(
            streams.held(1),
            vec![
                start("a"),
                text("a", &"x".repeat(MAX_TEXT)),
                dropped.clone()
            ]
        );
        let seen = seen.lock().unwrap();
        assert_eq!(seen.iter().filter(|e| **e == dropped).count(), 1);
        assert!(!seen.contains(&empty), "nothing of it is sent on");
    }

    #[test]
    fn a_page_that_went_away_stops_being_sent_to() {
        let streams = Streams::default();
        streams.apply(1, start("a"));
        streams.watch(1, Arc::new(|_| false));
        streams.apply(1, end("a"));
        assert!(sync::lock(&streams.calls)[&1].watchers.is_empty());
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
