//! Calls: opening one on a project (the agent worker and a call row), the LiveKit token that
//! joins it and dispatches the agent with the project, ending it, and keeping its transcript.
//! LiveKit keeps no transcripts, so the page sends each line here as it arrives
//! (docs/decisions/app-data-in-one-sqlite-db.md).

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
use crate::{agent_picks, agents, call_server, credentials, projects, settings, updates, windows};

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
    picks: HashMap<String, Vec<Pick>>,
    /// The Zep user the call remembers as, or empty when memory across calls is off.
    memory_user: String,
    /// Reads memory but saves nothing.
    memory_incognito: bool,
    /// The voice provider it talks through, with its voice and options.
    voice: CallVoice,
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
    /// `user` or `agent`.
    #[cfg_attr(test, ts(type = "\"user\" | \"agent\""))]
    role: String,
    text: String,
    created_at: i64,
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
/// far (`CallOptions.from_job` in `agent/call_options.py`).
fn dispatch_metadata(
    project: &projects::CallProject,
    agents: &[(String, PathBuf)],
    picks: &HashMap<String, Vec<Pick>>,
    voice: &CallVoice,
    settings: &settings::CallSettings,
    memory: (&str, bool),
    history: &[HistoryLine],
) -> String {
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
        "agents": agents,
        "picks": picks,
        "provider": voice.provider.id(),
        "provider_options": voice.options,
        "voice": voice.voice,
        "user_name": settings.user_name,
        "tone": settings.tone,
        "memory_user": memory.0,
        "memory_incognito": memory.1,
        "history": history,
    })
    .to_string()
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
    folders_are_there(&projects::for_call(&db.conn(), project_id)?)?;
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
                },
                &log_dir,
                report_crashes(&app),
            )?;
            Ok(server)
        })();
        (lookup.join().unwrap_or_default(), started)
    });
    let server = started?;

    let conn = db.conn();
    // Read before the call is recorded, so a failed read leaves no call without its agents.
    let picks = agent_picks::saved(&conn)?;
    let call_voice = voice::for_call(&conn, provider)?;
    let call_id = match resume_call_id {
        Some(call_id) => {
            reopen(&conn, project_id, call_id)?;
            call_id
        }
        None => {
            conn.execute(
                "INSERT INTO calls (project_id, started_at) VALUES (?1, ?2)",
                params![project_id, now_ms()],
            )?;
            conn.last_insert_rowid()
        }
    };
    call_agents.set(
        call_id,
        OpenedWith {
            server,
            agents: found,
            picks,
            memory_user,
            memory_incognito,
            voice: call_voice,
        },
    );
    opening.opened(call_id);
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
    let (project, history, settings) = {
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
            projects::for_call(&conn, project_id)?,
            recent_lines(&conn, call_id)?,
            settings::for_call(&conn)?,
        )
    };
    let room = room_name(call_id);
    // A call opened in this run has its own list; any other gets the last one found.
    let OpenedWith {
        server,
        agents,
        picks,
        memory_user,
        memory_incognito,
        voice,
    } = match call_agents.get(call_id) {
        Some(opened) => opened,
        None => OpenedWith {
            voice: voice::for_call(&db.conn(), voice::for_new_call(&app, &db, &vault)?)?,
            server: call_server::current(&app, &db, &vault, &local)?,
            agents: agents::usable(&found.cached().unwrap_or_default()),
            picks: agent_picks::saved(&db.conn())?,
            // The worker that has the Zep key was started with an opened call.
            memory_user: String::new(),
            memory_incognito: false,
        },
    };
    let metadata = dispatch_metadata(
        &project,
        &agents,
        &picks,
        &voice,
        &settings,
        (&memory_user, memory_incognito),
        &history,
    );
    Ok(CallToken {
        participant_token: token(&server, &room, metadata)?,
        server_url: server.url,
    })
}

#[tauri::command(async)]
pub fn end_call<R: Runtime>(app: AppHandle<R>, db: State<'_, Db>, call_id: i64) -> Result<()> {
    updates::call_ended(&app, call_id);
    db.conn().execute(
        "UPDATE calls SET ended_at = ?1 WHERE id = ?2 AND ended_at IS NULL",
        params![now_ms(), call_id],
    )?;
    Ok(())
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
    conn.execute(
        "INSERT INTO messages (call_id, segment_id, role, text, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (call_id, segment_id) DO UPDATE SET text = excluded.text",
        params![call_id, line.segment_id, line.role, line.text, now_ms()],
    )?;
    Ok(())
}

fn messages(conn: &Connection, call_id: i64) -> Result<Vec<Message>> {
    conn.prepare(
        "SELECT id, role, text, created_at FROM messages
         WHERE call_id = ?1 ORDER BY created_at, id",
    )?
    .query_map([call_id], |row| {
        Ok(Message {
            id: row.get(0)?,
            role: row.get(1)?,
            text: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?
    .collect::<rusqlite::Result<_>>()
    .map_err(Into::into)
}

/// Saves one transcript line, or updates it if its segment was saved before.
#[tauri::command(async)]
pub fn save_message(db: State<'_, Db>, call_id: i64, line: MessageInput) -> Result<()> {
    save(&db.conn(), call_id, &line)
}

/// A call's saved transcript, in order.
#[tauri::command(async)]
pub fn call_messages(db: State<'_, Db>, call_id: i64) -> Result<Vec<Message>> {
    messages(&db.conn(), call_id)
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
            memory_user: "bomby-0123456789abcdef".into(),
            memory_incognito: false,
            voice: rime(),
        };
        agents.set(1, claude.clone());
        assert_eq!(agents.get(1), Some(claude));
        assert_eq!(agents.get(2), None);

        let none = OpenedWith {
            server,
            agents: vec![],
            picks: HashMap::new(),
            memory_user: String::new(),
            memory_incognito: false,
            voice: rime(),
        };
        agents.set(2, none.clone());
        assert_eq!(agents.get(1), None);
        assert_eq!(agents.get(2), Some(none));
    }
    use livekit_api::access_token::TokenVerifier;

    fn call(conn: &Connection) -> i64 {
        conn.execute(
            "INSERT INTO projects (name, created_at) VALUES ('samba', 0)",
            [],
        )
        .unwrap();
        let project = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO calls (project_id, started_at) VALUES (?1, 0)",
            [project],
        )
        .unwrap();
        conn.last_insert_rowid()
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

        let saved: Vec<_> = messages(&conn, id)
            .unwrap()
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
        assert!(messages(&conn, id).unwrap().is_empty());
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
        let project = projects::for_call(&conn, 1).unwrap();
        let history = [HistoryLine {
            role: "agent".into(),
            text: "Hi.".into(),
        }];
        let agents = [("claude".to_owned(), PathBuf::from("/usr/local/bin/claude"))];
        let voice = CallVoice {
            provider: VoiceProvider::Gemini,
            voice: "Kore".into(),
            options: BTreeMap::from([("google_search", false)]),
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
        let metadata: serde_json::Value = serde_json::from_str(&dispatch_metadata(
            &project,
            &agents,
            &picks,
            &voice,
            &settings,
            ("bomby-0123456789abcdef", true),
            &history,
        ))
        .unwrap();
        assert_eq!(
            metadata,
            serde_json::json!({
                "project": "samba",
                "folders": ["/tmp"],
                "instructions": "A music app.",
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
    fn a_call_needs_every_folder_to_be_there() {
        let here = env!("CARGO_MANIFEST_DIR").to_owned();
        let project = |folders: Vec<String>| projects::CallProject {
            name: "samba".into(),
            folders,
            instructions: String::new(),
        };
        assert!(folders_are_there(&project(vec![here.clone()])).is_ok());
        let gone = folders_are_there(&project(vec![here, "/Users/me/Dev/gone".into()]));
        assert_eq!(
            gone.unwrap_err().to_string(),
            "The folder gone isn't there any more. Add it again in Project settings."
        );
    }
}
