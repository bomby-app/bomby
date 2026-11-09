//! Calls: opening one on a project (the agent worker and a call row), the LiveKit token that
//! joins it and dispatches the agent with the project, ending it, keeping its transcript and
//! its name. LiveKit keeps no transcripts, so the page sends each line here as it arrives
//! (docs/decisions/app-data-in-one-sqlite-db.md). Each opening or resuming of a call is one
//! of its sessions, and each line is kept with the session it was said in
//! (docs/decisions/call-names-and-sessions.md).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use livekit_api::access_token::{AccessToken, VideoGrants};
use livekit_protocol::{RoomAgentDispatch, RoomConfiguration};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::agent::{AgentWorker, JobCrash, OnCrash, WorkerConfig};
use crate::credentials::LiveKitKeys;
use crate::db::{Db, now_ms};
use crate::error::{Error, Result};
use crate::local_server::LocalServer;
use crate::setup::Pick;
use crate::sync;
use crate::voice::{self, CallVoice};
use crate::{
    agent_picks, agents, call_server, credentials, extensions, projects, settings, updates, windows,
};

/// Sent to every window when a call is named or renamed, by the user or by Bomby.
pub const RENAMED: &str = "call-renamed";
/// A few words, short enough for a sidebar row. The page holds the same limit
/// (`features/call/limits.ts`).
const MAX_NAME_LEN: usize = 60;
/// The agent's name in `agent/agent.py` (`AGENT_NAME`), which the token dispatches.
const AGENT_NAME: &str = "bomby";
/// Only for joining; a call outlives its token.
const TOKEN_TTL: Duration = Duration::from_secs(10 * 60);
/// How much of a resumed call the agent is told: the last this many lines.
const RESUME_LINES: i64 = 50;
/// Sent to the main window when a call's agent job crashes, so the call fails at once
/// instead of after the agent's join timeout.
pub const AGENT_CRASHED: &str = "call-agent-crashed";

/// What the main window hears when a call's agent job crashed. By room, not call: a
/// resumed call has the same id in a new room, and an earlier room's job may crash late.
#[derive(Debug, Clone, Serialize)]
struct AgentCrashed {
    room: String,
    /// What went wrong, in the agent's words: "project folder does not exist: ...".
    reason: String,
}

/// A new room for `call_id` every time, also when resuming. Unique across reinstalls too,
/// since row ids start over with a new database.
fn room_name(call_id: i64) -> String {
    format!("bomby-{call_id}-{}", now_ms())
}

/// Fails the call before it starts when a folder is gone (moved, renamed or deleted since it
/// was added), which would otherwise crash the agent's job (`Project.from_job`).
fn folders_are_there(project: &projects::CallProject) -> Result<()> {
    for folder in &project.folders {
        let path = Path::new(folder);
        if !path.is_dir() {
            let name = path
                .file_name()
                .map_or(folder.as_str(), |n| n.to_str().unwrap_or(folder.as_str()));
            return Err(Error::Invalid(format!(
                "The folder {name} isn't there any more. Add it again in Project settings."
            )));
        }
    }
    Ok(())
}

/// Tells the main window about each crashed job, by its room.
fn report_crashes<R: Runtime>(app: &AppHandle<R>) -> OnCrash {
    let app = app.clone();
    Arc::new(move |JobCrash { room, reason }| {
        let _ = app.emit_to(windows::MAIN, AGENT_CRASHED, AgentCrashed { room, reason });
    })
}

/// The agents the current call opened with, and their picks. Every token for that call
/// carries the same ones, so a reconnect mid-call never hands the voice agent a different
/// list or model, whatever looking for agents or picking finds meanwhile
/// (`agents::Agents`, `agent_picks`); a pick made during a call applies from the next one.
/// The app runs one call at a time (one LiveKit session), so opening the next one replaces
/// it.
#[derive(Default)]
pub struct CallAgents(Mutex<Option<CurrentCall>>);

/// What a call opened with: its agents by id with their programs, and their picks.
#[derive(Debug, Clone, PartialEq)]
struct OpenedWith {
    /// Kept too, so a reconnect never lands on another server.
    server: LiveKitKeys,
    agents: Vec<(String, PathBuf)>,
    /// The project's agents were off: the voice says so, rather than that none is installed.
    agents_off: bool,
    picks: HashMap<String, Vec<Pick>>,
    /// The Zep user the call remembers as, or empty when memory across calls is off.
    memory_user: String,
    /// Reads memory but saves nothing.
    memory_incognito: bool,
    /// The voice provider it talks through, with its voice and options.
    voice: CallVoice,
    /// Its extensions, by id (Settings, Extensions, or the project's own choice).
    extensions: Vec<String>,
}

/// A call id and what it opened with.
type CurrentCall = (i64, OpenedWith);

impl CallAgents {
    fn set(&self, call_id: i64, opened: OpenedWith) {
        *self.lock() = Some((call_id, opened));
    }

    fn get(&self, call_id: i64) -> Option<OpenedWith> {
        self.lock()
            .as_ref()
            .filter(|(id, _)| *id == call_id)
            .map(|(_, opened)| opened.clone())
    }

    fn lock(&self) -> MutexGuard<'_, Option<CurrentCall>> {
        sync::lock(&self.0)
    }
}

/// What the page needs to join the call.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "call.ts"))]
pub struct CallToken {
    server_url: String,
    participant_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "call.ts"))]
pub struct Message {
    id: i64,
    /// The session it was said in.
    session_id: i64,
    /// `user` or `agent`.
    #[cfg_attr(test, ts(type = "\"user\" | \"agent\""))]
    role: String,
    text: String,
    created_at: i64,
}

/// One stretch of a call: from opening or resuming it to its end.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "call.ts"))]
pub struct CallSession {
    id: i64,
    started_at: i64,
    /// None while it's on, or when the app quit during it and the call wasn't resumed
    /// since.
    ended_at: Option<i64>,
}

/// A call's saved conversation: its sessions and its lines, each in order.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "call.ts"))]
pub struct Transcript {
    sessions: Vec<CallSession>,
    messages: Vec<Message>,
}

/// Who named a call: the user in the app, or Bomby on a call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "call.ts"))]
pub enum Namer {
    User,
    Bomby,
}

impl Namer {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Bomby => "bomby",
        }
    }

    fn parse(text: &str) -> Self {
        if text == "bomby" {
            Self::Bomby
        } else {
            Self::User
        }
    }
}

/// A call's name and who gave it; both None until it's named.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "call.ts"))]
pub struct CallName {
    name: Option<String>,
    named_by: Option<Namer>,
}

/// Sent with `RENAMED`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "call.ts"))]
pub struct CallRenamed {
    project_id: i64,
    call_id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageInput {
    /// The LiveKit transcription segment, so a line saved again replaces itself.
    segment_id: String,
    /// "user" or "agent".
    role: String,
    text: String,
}

/// One line of an earlier conversation, as the agent reads it.
#[derive(Serialize)]
struct HistoryLine {
    role: String,
    text: String,
}

/// The job metadata the agent reads: the project with what the user wrote about it
/// (`Project.from_job` in `agent/project.py`), the agents found on this computer by id with
/// their programs and the picks each session gets (`JobMetadata.picks` in `agent/job.py`,
/// applied by `apply` in `agent/acp_client/settings.py`), the voice provider with its voice
/// and options, what the user likes to be called and, on a resumed call, the conversation so
/// far (`CallOptions.from_job` in `agent/call_options.py`), and its extensions with what each
/// needs at the start (`extensions::for_call`, `agent/extensions/`). What the call opened with
/// comes from `opened` alone, so every token for the call carries the same.
fn dispatch_metadata(
    project: &projects::CallProject,
    opened: &OpenedWith,
    settings: &settings::CallSettings,
    history: &[HistoryLine],
    extensions: &serde_json::Map<String, serde_json::Value>,
) -> String {
    let OpenedWith {
        agents,
        agents_off,
        picks,
        memory_user,
        memory_incognito,
        voice,
        ..
    } = opened;
    let picks: HashMap<_, _> = agents
        .iter()
        .filter_map(|(id, _)| Some((id, picks.get(id)?)))
        .collect();
    let agents: serde_json::Map<_, _> = agents
        .iter()
        .map(|(id, path)| (id.clone(), path.display().to_string().into()))
        .collect();
    serde_json::json!({
        "project": project.name,
        "folders": project.folders,
        "instructions": project.instructions,
        "agents_off": agents_off,
        "agents": agents,
        "picks": picks,
        "provider": voice.provider.id(),
        "provider_options": voice.options,
        "voice": voice.voice,
        "user_name": settings.user_name,
        "tone": settings.tone,
        "memory_user": memory_user,
        "memory_incognito": memory_incognito,
        "history": history,
        "extensions": extensions,
    })
    .to_string()
}

/// The agents among `found` the project lets its calls hand work to.
fn for_project(
    found: Vec<(String, PathBuf)>,
    agents: &projects::ProjectAgents,
) -> Vec<(String, PathBuf)> {
    found
        .into_iter()
        .filter(|(id, _)| agents.allows(id))
        .collect()
}

/// The last `RESUME_LINES` lines of a call, oldest first.
fn recent_lines(conn: &Connection, call_id: i64) -> Result<Vec<HistoryLine>> {
    let mut lines = conn
        .prepare(
            "SELECT role, text FROM messages WHERE call_id = ?1
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        )?
        .query_map(params![call_id, RESUME_LINES], |row| {
            Ok(HistoryLine {
                role: row.get(0)?,
                text: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    lines.reverse();
    Ok(lines)
}

/// Starts a session of the call, the one its lines are saved in from now on. A session the
/// app quit during, which nothing ended, ends at its last line first (at its start if it
/// has none).
fn begin_session(conn: &Connection, call_id: i64, at: i64) -> Result<()> {
    conn.execute(
        "UPDATE call_sessions SET ended_at = COALESCE(
             (SELECT MAX(created_at) FROM messages WHERE session_id = call_sessions.id),
             started_at)
         WHERE call_id = ?1 AND ended_at IS NULL",
        [call_id],
    )?;
    conn.execute(
        "INSERT INTO call_sessions (call_id, started_at) VALUES (?1, ?2)",
        params![call_id, at],
    )?;
    Ok(())
}

/// Reopens an earlier call of this project, so new lines join it.
fn reopen(conn: &Connection, project_id: i64, call_id: i64) -> Result<()> {
    let reopened = conn.execute(
        "UPDATE calls SET ended_at = NULL WHERE id = ?1 AND project_id = ?2",
        params![call_id, project_id],
    )?;
    if reopened == 0 {
        return Err(Error::NotFound("call"));
    }
    Ok(())
}

/// The Zep user a new call remembers as, or empty, and the saved Zep key. The worker gets
/// the key whenever one is saved, so the switch never restarts it: the call's metadata
/// turns memory on, and needs both the setting and the key.
fn memory_for_call<R: Runtime>(
    app: &AppHandle<R>,
    db: &Db,
    vault: &credentials::Vault,
) -> Result<(String, Option<String>)> {
    let key = vault.zep_key(app)?;
    let conn = db.conn();
    let user = if key.is_some() && settings::memory(&conn)? == settings::Memory::Zep {
        settings::memory_user(&conn)?
    } else {
        String::new()
    };
    Ok((user, key))
}

fn token(keys: &LiveKitKeys, room: &str, metadata: String) -> Result<String> {
    AccessToken::with_api_key(&keys.api_key, &keys.api_secret)
        .with_identity("user")
        .with_name("You")
        .with_ttl(TOKEN_TTL)
        .with_grants(VideoGrants {
            room_join: true,
            room: room.to_owned(),
            can_publish: Some(true),
            can_subscribe: Some(true),
            can_publish_data: Some(true),
            ..Default::default()
        })
        .with_room_config(RoomConfiguration {
            name: room.to_owned(),
            agents: vec![RoomAgentDispatch {
                agent_name: AGENT_NAME.to_owned(),
                metadata,
                ..Default::default()
            }],
            ..Default::default()
        })
        .to_jwt()
        .map_err(|e| Error::Invalid(format!("Couldn't make the call token: {e}")))
}

/// Opens a call on a project, or reopens one of its earlier calls (`resume_call_id`), after
/// making sure the agent worker runs (it can take a few seconds the first time). Joining is
/// `call_token`'s job.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)] // Tauri passes each state as an argument.
pub fn open_call<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    worker: State<'_, AgentWorker>,
    vault: State<'_, credentials::Vault>,
    local: State<'_, LocalServer>,
    call_agents: State<'_, CallAgents>,
    project_id: i64,
    resume_call_id: Option<i64>,
) -> Result<i64> {
    // Holds off an update's restart while the call opens; refused if one is under way.
    let opening = updates::CallOpening::begin(&app)?;
    let project = projects::for_call(&db.conn(), project_id)?;
    folders_are_there(&project)?;
    let provider = voice::for_new_call(&app, &db, &vault)?;
    let voice_keys = vault.voice_keys(&app)?;
    // Read before the server starts, so this Mac's server starts only for a call that can open.
    let (memory_user, zep_key) = memory_for_call(&app, &db, &vault)?;
    let memory_incognito = settings::incognito(&db.conn())?;
    // Finds the agents (a login shell) while the server and worker start.
    let (found, started) = thread::scope(|scope| {
        let lookup = scope.spawn(|| agents::usable_now(&app));
        let started = (|| -> Result<LiveKitKeys> {
            let server = call_server::for_new_call(&app, &db, &vault, &local)?;
            let log_dir = app.path().app_log_dir()?;
            worker.ensure(
                WorkerConfig {
                    livekit: server.clone(),
                    voice_keys,
                    zep_key,
                    tokens: app
                        .state::<extensions::tokens::Tokens>()
                        .0
                        .as_ref()
                        .map(extensions::tokens::TokenSocket::env),
                },
                &log_dir,
                report_crashes(&app),
            )?;
            Ok(server)
        })();
        (lookup.join().unwrap_or_default(), started)
    });
    // Only the agents the project lets its calls use (Project settings, Agents).
    let found = for_project(found, &project.agents);
    let server = started?;

    let conn = db.conn();
    // Read before the call is recorded, so a failed read leaves no call without its agents.
    let picks = agent_picks::saved(&conn)?;
    let call_voice = voice::for_call(&conn, provider)?;
    let connected = extensions::connections::connected(&app, &vault)?;
    let call_extensions = extensions::on_for(&conn, &project.extensions, &connected)?;
    let call_id = start(&conn, project_id, resume_call_id)?;
    call_agents.set(
        call_id,
        OpenedWith {
            server,
            agents: found,
            agents_off: !project.agents.on,
            picks,
            memory_user,
            memory_incognito,
            voice: call_voice,
            extensions: call_extensions,
        },
    );
    opening.opened(call_id);
    Ok(call_id)
}

/// A new call on the project, or `resume_call_id` reopened, with a session begun.
fn start(conn: &Connection, project_id: i64, resume_call_id: Option<i64>) -> Result<i64> {
    // One clock read: a new call and its first session start at the same moment.
    let now = now_ms();
    let tx = conn.unchecked_transaction()?;
    let call_id = match resume_call_id {
        Some(call_id) => {
            reopen(&tx, project_id, call_id)?;
            call_id
        }
        None => {
            tx.execute(
                "INSERT INTO calls (project_id, started_at) VALUES (?1, ?2)",
                params![project_id, now],
            )?;
            tx.last_insert_rowid()
        }
    };
    begin_session(&tx, call_id, now)?;
    tx.commit()?;
    Ok(call_id)
}

/// A token for a new room on the call, dispatching the agent with the project, the call's
/// settings and its last lines (none on a new call). It only reads: LiveKit's session fetches
/// tokens on its own too (on mount, and on end and disconnects, to have the next one ready),
/// so getting one must not change anything (docs/livekit-notes.md).
#[tauri::command(async)]
pub fn call_token<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    vault: State<'_, credentials::Vault>,
    local: State<'_, LocalServer>,
    found: State<'_, agents::Agents>,
    call_agents: State<'_, CallAgents>,
    call_id: i64,
) -> Result<CallToken> {
    let (project_id, project, history, settings) = {
        let conn = db.conn();
        let project_id: i64 = conn
            .query_row(
                "SELECT project_id FROM calls WHERE id = ?1",
                [call_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(Error::NotFound("call"))?;
        (
            project_id,
            projects::for_call(&conn, project_id)?,
            recent_lines(&conn, call_id)?,
            settings::for_call(&conn)?,
        )
    };
    let room = room_name(call_id);
    // A call opened in this run has its own list; any other gets the last one found.
    let opened = match call_agents.get(call_id) {
        Some(opened) => opened,
        None => OpenedWith {
            voice: voice::for_token(&app, &db, &vault)?,
            server: call_server::current(&app, &db, &vault, &local)?,
            agents: for_project(
                agents::usable(&found.cached().unwrap_or_default()),
                &project.agents,
            ),
            agents_off: !project.agents.on,
            picks: agent_picks::saved(&db.conn())?,
            // The worker that has the Zep key was started with an opened call.
            memory_user: String::new(),
            memory_incognito: false,
            extensions: extensions::on_for(
                &db.conn(),
                &project.extensions,
                &extensions::connections::connected(&app, &vault)?,
            )?,
        },
    };
    // Read fresh for each room, so a reconnect starts from the list as it is now.
    let extension_data = extensions::for_call(&db.conn(), project_id, call_id, &opened.extensions)?;
    let metadata = dispatch_metadata(&project, &opened, &settings, &history, &extension_data);
    let server = opened.server;
    Ok(CallToken {
        participant_token: token(&server, &room, metadata)?,
        server_url: server.url,
    })
}

/// Ends the call and its session.
fn end(conn: &Connection, call_id: i64, at: i64) -> Result<()> {
    conn.execute(
        "UPDATE calls SET ended_at = ?1 WHERE id = ?2 AND ended_at IS NULL",
        params![at, call_id],
    )?;
    conn.execute(
        "UPDATE call_sessions SET ended_at = ?1 WHERE call_id = ?2 AND ended_at IS NULL",
        params![at, call_id],
    )?;
    Ok(())
}

#[tauri::command(async)]
pub fn end_call<R: Runtime>(app: AppHandle<R>, db: State<'_, Db>, call_id: i64) -> Result<()> {
    updates::call_ended(&app, call_id);
    end(&db.conn(), call_id, now_ms())
}

/// Deletes a call and its transcript (ON DELETE CASCADE).
fn delete(conn: &Connection, call_id: i64) -> Result<()> {
    conn.execute("DELETE FROM calls WHERE id = ?1", [call_id])?;
    Ok(())
}

#[tauri::command(async)]
pub fn delete_call(db: State<'_, Db>, call_id: i64) -> Result<()> {
    delete(&db.conn(), call_id)
}

fn save(conn: &Connection, call_id: i64, line: &MessageInput) -> Result<()> {
    if !matches!(line.role.as_str(), "user" | "agent") {
        return Err(Error::Invalid(format!("unknown speaker {}", line.role)));
    }
    // In the call's latest session, also a line that lands just after the call ended.
    let session: i64 = conn
        .query_row(
            "SELECT id FROM call_sessions WHERE call_id = ?1
             ORDER BY started_at DESC, id DESC LIMIT 1",
            [call_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(Error::NotFound("call"))?;
    conn.execute(
        "INSERT INTO messages (call_id, session_id, segment_id, role, text, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (call_id, segment_id) DO UPDATE SET text = excluded.text",
        params![
            call_id,
            session,
            line.segment_id,
            line.role,
            line.text,
            now_ms()
        ],
    )?;
    Ok(())
}

fn transcript(conn: &Connection, call_id: i64) -> Result<Transcript> {
    let sessions = conn
        .prepare(
            "SELECT id, started_at, ended_at FROM call_sessions
             WHERE call_id = ?1 ORDER BY started_at, id",
        )?
        .query_map([call_id], |row| {
            Ok(CallSession {
                id: row.get(0)?,
                started_at: row.get(1)?,
                ended_at: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let messages = conn
        .prepare(
            "SELECT id, session_id, role, text, created_at FROM messages
             WHERE call_id = ?1 AND session_id IS NOT NULL ORDER BY created_at, id",
        )?
        .query_map([call_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                text: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Transcript { sessions, messages })
}

/// The call's name and who gave it.
pub(crate) fn name_of(conn: &Connection, call_id: i64) -> Result<CallName> {
    conn.query_row(
        "SELECT name, named_by FROM calls WHERE id = ?1",
        [call_id],
        |row| {
            Ok(CallName {
                name: row.get(0)?,
                named_by: row
                    .get::<_, Option<String>>(1)?
                    .as_deref()
                    .map(Namer::parse),
            })
        },
    )
    .optional()?
    .ok_or(Error::NotFound("call"))
}

/// Names the call, its words on one line; no words take its name away, so it shows when
/// it started again. Returns its project with the name as it is now.
fn rename(conn: &Connection, call_id: i64, name: &str, by: Namer) -> Result<(i64, CallName)> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.chars().count() > MAX_NAME_LEN {
        return Err(Error::Invalid(format!(
            "Keep a call's name under {MAX_NAME_LEN} characters."
        )));
    }
    let (name, by) = if name.is_empty() {
        (None, None)
    } else {
        (Some(name), Some(by.as_str()))
    };
    let project_id: i64 = conn
        .query_row(
            "UPDATE calls SET name = ?1, named_by = ?2 WHERE id = ?3 RETURNING project_id",
            params![name, by, call_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(Error::NotFound("call"))?;
    Ok((project_id, name_of(conn, call_id)?))
}

/// Names or renames a call, for the user or for Bomby (`by`), and tells every window.
#[tauri::command(async)]
pub fn rename_call<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    call_id: i64,
    name: String,
    by: Namer,
) -> Result<CallName> {
    let (project_id, now) = rename(&db.conn(), call_id, &name, by)?;
    let _ = app.emit(
        RENAMED,
        CallRenamed {
            project_id,
            call_id,
        },
    );
    Ok(now)
}

/// Saves one transcript line, or updates it if its segment was saved before.
#[tauri::command(async)]
pub fn save_message(db: State<'_, Db>, call_id: i64, line: MessageInput) -> Result<()> {
    save(&db.conn(), call_id, &line)
}

/// A call's saved conversation, its sessions and lines in order.
#[tauri::command(async)]
pub fn call_transcript(db: State<'_, Db>, call_id: i64) -> Result<Transcript> {
    transcript(&db.conn(), call_id)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::voice::VoiceProvider;

    fn rime() -> CallVoice {
        CallVoice {
            provider: VoiceProvider::Rime,
            voice: "aurora".into(),
            options: BTreeMap::new(),
        }
    }

    #[test]
    fn the_current_call_keeps_its_server_and_agents_until_the_next_one_opens() {
        let agents = CallAgents::default();
        let server = LiveKitKeys {
            url: "ws://127.0.0.1:41000".into(),
            api_key: "bomby".into(),
            api_secret: "secret".into(),
        };
        let claude = OpenedWith {
            server: server.clone(),
            agents: vec![(
                "claude".to_owned(),
                PathBuf::from("/Users/me/.local/bin/claude"),
            )],
            picks: HashMap::from([(
                "claude".to_owned(),
                vec![Pick {
                    setting: "model".into(),
                    value: "opus".into(),
                }],
            )]),
            agents_off: false,
            memory_user: "bomby-0123456789abcdef".into(),
            memory_incognito: false,
            voice: rime(),
            extensions: vec!["todos".into()],
        };
        agents.set(1, claude.clone());
        assert_eq!(agents.get(1), Some(claude));
        assert_eq!(agents.get(2), None);

        let none = OpenedWith {
            server,
            agents: vec![],
            picks: HashMap::new(),
            agents_off: true,
            memory_user: String::new(),
            memory_incognito: false,
            voice: rime(),
            extensions: vec!["todos".into()],
        };
        agents.set(2, none.clone());
        assert_eq!(agents.get(1), None);
        assert_eq!(agents.get(2), Some(none));
    }
    use livekit_api::access_token::TokenVerifier;

    /// A new call on a new project, with its first session begun.
    fn call(conn: &Connection) -> i64 {
        conn.execute(
            "INSERT INTO projects (name, created_at) VALUES ('samba', 0)",
            [],
        )
        .unwrap();
        start(conn, conn.last_insert_rowid(), None).unwrap()
    }

    fn project_of(conn: &Connection, call_id: i64) -> i64 {
        conn.query_row(
            "SELECT project_id FROM calls WHERE id = ?1",
            [call_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    fn line(segment: &str, role: &str, text: &str) -> MessageInput {
        MessageInput {
            segment_id: segment.into(),
            role: role.into(),
            text: text.into(),
        }
    }

    #[test]
    fn a_segment_saved_twice_keeps_one_line_with_the_latest_text() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let id = call(&conn);
        save(&conn, id, &line("s1", "user", "can you")).unwrap();
        save(&conn, id, &line("s2", "agent", "sure")).unwrap();
        save(&conn, id, &line("s1", "user", "can you fix the login")).unwrap();

        let saved: Vec<_> = transcript(&conn, id)
            .unwrap()
            .messages
            .into_iter()
            .map(|m| (m.role, m.text))
            .collect();
        assert_eq!(
            saved,
            [
                ("user".into(), "can you fix the login".into()),
                ("agent".into(), "sure".into())
            ]
        );
        assert!(save(&conn, id, &line("s3", "system", "x")).is_err());
    }

    #[test]
    fn resuming_reopens_the_call_and_the_agent_gets_its_last_lines_oldest_first() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let id = call(&conn);
        conn.execute("UPDATE calls SET ended_at = 5 WHERE id = ?1", [id])
            .unwrap();
        for n in 0..(RESUME_LINES + 3) {
            conn.execute(
                "INSERT INTO messages (call_id, segment_id, role, text, created_at)
                 VALUES (?1, ?2, 'user', ?3, ?4)",
                params![id, format!("s{n}"), format!("line {n}"), n],
            )
            .unwrap();
        }

        let project: i64 = conn
            .query_row("SELECT project_id FROM calls WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        reopen(&conn, project, id).unwrap();
        let history = recent_lines(&conn, id).unwrap();
        assert_eq!(history.len(), usize::try_from(RESUME_LINES).unwrap());
        assert_eq!(history[0].text, "line 3");
        assert_eq!(
            history.last().unwrap().text,
            format!("line {}", RESUME_LINES + 2)
        );
        let ended: Option<i64> = conn
            .query_row("SELECT ended_at FROM calls WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(ended, None);
        assert!(matches!(
            reopen(&conn, project + 1, id),
            Err(Error::NotFound(_))
        ));
    }

    #[test]
    fn each_opening_is_a_session_and_each_line_keeps_the_one_it_was_said_in() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let id = call(&conn);
        save(&conn, id, &line("s1", "user", "fix the login")).unwrap();
        end(&conn, id, now_ms()).unwrap();
        // A last line that lands after the call ended still joins its session.
        save(&conn, id, &line("s2", "agent", "on it")).unwrap();

        start(&conn, project_of(&conn, id), Some(id)).unwrap();
        save(&conn, id, &line("s3", "user", "and the signup")).unwrap();
        // A line said again in a later session keeps the session it was first said in.
        save(&conn, id, &line("s1", "user", "fix the login page")).unwrap();

        let Transcript { sessions, messages } = transcript(&conn, id).unwrap();
        assert_eq!(sessions.len(), 2);
        assert!(sessions[0].ended_at.is_some() && sessions[1].ended_at.is_none());
        let by_session: Vec<_> = messages
            .iter()
            .map(|m| (m.text.as_str(), m.session_id))
            .collect();
        assert_eq!(
            by_session,
            [
                ("fix the login page", sessions[0].id),
                ("on it", sessions[0].id),
                ("and the signup", sessions[1].id),
            ]
        );
        let started: i64 = conn
            .query_row("SELECT started_at FROM calls WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            started, sessions[0].started_at,
            "resuming keeps the call's start"
        );
    }

    #[test]
    fn a_session_the_app_quit_during_ends_at_its_last_line_when_the_call_resumes() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let id = call(&conn);
        conn.execute("UPDATE call_sessions SET started_at = 100", [])
            .unwrap();
        save(&conn, id, &line("s1", "user", "hello")).unwrap();
        conn.execute("UPDATE messages SET created_at = 160", [])
            .unwrap();
        let quiet = start(&conn, project_of(&conn, id), None).unwrap();
        conn.execute(
            "UPDATE call_sessions SET started_at = 200 WHERE call_id = ?1",
            [quiet],
        )
        .unwrap();

        // The app quit: nothing ended either call.
        start(&conn, project_of(&conn, id), Some(id)).unwrap();
        start(&conn, project_of(&conn, quiet), Some(quiet)).unwrap();
        let ends = |call_id| -> Vec<Option<i64>> {
            transcript(&conn, call_id)
                .unwrap()
                .sessions
                .iter()
                .map(|s| s.ended_at)
                .collect()
        };
        assert_eq!(ends(id), [Some(160), None]);
        assert_eq!(ends(quiet), [Some(200), None], "no lines: at its start");
    }

    #[test]
    fn a_call_is_named_on_one_line_and_no_words_take_its_name_away() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let id = call(&conn);
        let unnamed = CallName {
            name: None,
            named_by: None,
        };
        assert_eq!(name_of(&conn, id).unwrap(), unnamed);

        let (project, named) = rename(&conn, id, "  Login\n flow ", Namer::Bomby).unwrap();
        assert_eq!(project, project_of(&conn, id));
        assert_eq!(
            named,
            CallName {
                name: Some("Login flow".into()),
                named_by: Some(Namer::Bomby),
            }
        );
        let (_, renamed) = rename(&conn, id, "Signup", Namer::User).unwrap();
        assert_eq!(renamed.named_by, Some(Namer::User));

        let longest = "x".repeat(MAX_NAME_LEN);
        assert!(rename(&conn, id, &longest, Namer::User).is_ok());
        assert!(matches!(
            rename(&conn, id, &format!("{longest}x"), Namer::Bomby),
            Err(Error::Invalid(_))
        ));
        assert_eq!(rename(&conn, id, " \n ", Namer::User).unwrap().1, unnamed);
        assert!(matches!(
            rename(&conn, id + 1, "Nope", Namer::User),
            Err(Error::NotFound(_))
        ));
    }

    #[test]
    fn deleting_a_call_takes_its_transcript_with_it() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let id = call(&conn);
        save(&conn, id, &line("s1", "user", "hello")).unwrap();
        delete(&conn, id).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
        let left = transcript(&conn, id).unwrap();
        assert!(left.messages.is_empty() && left.sessions.is_empty());
    }

    #[test]
    fn the_metadata_carries_the_project_agents_settings_and_history() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        conn.execute(
            "INSERT INTO projects (name, instructions, created_at)
             VALUES ('samba', 'A music app.', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO project_folders (project_id, position, path) VALUES (1, 0, '/tmp')",
            [],
        )
        .unwrap();
        // Turned off after the call opened with them on: its tokens keep what it opened with.
        conn.execute("UPDATE projects SET agents_on = 0 WHERE id = 1", [])
            .unwrap();
        let project = projects::for_call(&conn, 1).unwrap();
        let history = [HistoryLine {
            role: "agent".into(),
            text: "Hi.".into(),
        }];
        let agents = [("claude".to_owned(), PathBuf::from("/usr/local/bin/claude"))];
        let voice = CallVoice {
            provider: VoiceProvider::Gemini,
            voice: "Kore".into(),
            options: BTreeMap::from([("google_search", voice::OptionValue::On(false))]),
        };
        let settings = settings::CallSettings {
            user_name: "Sam".into(),
            tone: settings::Tone::Chatty,
        };
        let picks = HashMap::from([
            (
                "claude".to_owned(),
                vec![Pick {
                    setting: "model".into(),
                    value: "opus".into(),
                }],
            ),
            ("goose".to_owned(), Vec::new()),
        ]);
        let opened = OpenedWith {
            server: LiveKitKeys {
                url: "ws://127.0.0.1:41000".into(),
                api_key: "bomby".into(),
                api_secret: "secret".into(),
            },
            agents: agents.to_vec(),
            agents_off: false,
            picks,
            memory_user: "bomby-0123456789abcdef".into(),
            memory_incognito: true,
            voice,
            extensions: vec!["todos".into(), "call_names".into()],
        };
        let call_id = start(&conn, 1, None).unwrap();
        rename(&conn, call_id, "Tempo  bug\n", Namer::User).unwrap();
        let data = extensions::for_call(&conn, 1, call_id, &opened.extensions).unwrap();
        let metadata: serde_json::Value = serde_json::from_str(&dispatch_metadata(
            &project, &opened, &settings, &history, &data,
        ))
        .unwrap();
        assert_eq!(
            metadata,
            serde_json::json!({
                "project": "samba",
                "folders": ["/tmp"],
                "instructions": "A music app.",
                "agents_off": false,
                "agents": { "claude": "/usr/local/bin/claude" },
                // Only the call's agents' picks go along.
                "picks": { "claude": [{ "setting": "model", "value": "opus" }] },
                "provider": "gemini",
                "provider_options": { "google_search": false },
                "voice": "Kore",
                "user_name": "Sam",
                "tone": "chatty",
                "memory_user": "bomby-0123456789abcdef",
                "memory_incognito": true,
                "history": [{ "role": "agent", "text": "Hi." }],
                "extensions": {
                    "todos": { "open": [], "more": 0 },
                    "call_names": { "name": "Tempo bug", "namedBy": "user" },
                },
            })
        );
    }

    #[test]
    fn the_token_joins_the_room_and_dispatches_the_agent_with_the_project() {
        let keys = LiveKitKeys {
            url: "wss://x.livekit.cloud".into(),
            api_key: "key".into(),
            api_secret: "a-secret-long-enough-for-hs256-signing".into(),
        };
        let jwt = token(&keys, "bomby-1-0", r#"{"project":"samba"}"#.into()).unwrap();
        let claims = TokenVerifier::with_api_key("key", &keys.api_secret)
            .verify(&jwt)
            .unwrap();
        assert!(claims.video.room_join);
        assert_eq!(claims.video.room, "bomby-1-0");
        let config = claims.room_config.unwrap();
        assert_eq!(config.agents[0].agent_name, AGENT_NAME);
        assert_eq!(config.agents[0].metadata, r#"{"project":"samba"}"#);
    }

    #[test]
    fn a_call_gets_only_the_agents_its_project_allows() {
        let found = || {
            vec![
                ("claude".to_owned(), PathBuf::from("/bin/claude")),
                ("goose".to_owned(), PathBuf::from("/bin/goose")),
            ]
        };
        let ids = |agents: projects::ProjectAgents| -> Vec<String> {
            for_project(found(), &agents)
                .into_iter()
                .map(|(id, _)| id)
                .collect()
        };
        assert_eq!(ids(projects::ProjectAgents::default()), ["claude", "goose"]);
        let only_claude = projects::ProjectAgents {
            on: true,
            only: vec!["claude".into(), "codex".into()],
        };
        assert_eq!(ids(only_claude.clone()), ["claude"]);
        let off = projects::ProjectAgents {
            on: false,
            ..only_claude
        };
        assert!(ids(off).is_empty());
    }

    #[test]
    fn a_call_needs_every_folder_to_be_there() {
        let here = env!("CARGO_MANIFEST_DIR").to_owned();
        let project = |folders: Vec<String>| projects::CallProject {
            name: "samba".into(),
            folders,
            instructions: String::new(),
            agents: projects::ProjectAgents::default(),
            extensions: extensions::ProjectExtensions::default(),
        };
        assert!(folders_are_there(&project(vec![here.clone()])).is_ok());
        let gone = folders_are_there(&project(vec![here, "/Users/me/Dev/gone".into()]));
        assert_eq!(
            gone.unwrap_err().to_string(),
            "The folder gone isn't there any more. Add it again in Project settings."
        );
    }
}
