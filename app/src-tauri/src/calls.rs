//! Calls: opening one on a project (the agent worker and a call row), the LiveKit token that
//! joins it and dispatches the agent with the project, ending it, and keeping its transcript.
//! LiveKit keeps no transcripts, so the page sends each line here as it arrives
//! (docs/decisions/app-data-in-one-sqlite-db.md).

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use livekit_api::access_token::{AccessToken, VideoGrants};
use livekit_protocol::{RoomAgentDispatch, RoomConfiguration};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::agent::{AgentWorker, WorkerConfig};
use crate::db::{Db, now_ms};
use crate::error::{Error, Result};
use crate::{agents, credentials, projects, settings};

/// The agent's name in `agent/agent.py` (`AGENT_NAME`), which the token dispatches.
const AGENT_NAME: &str = "bomby";
/// Only for joining; a call outlives its token.
const TOKEN_TTL: Duration = Duration::from_secs(10 * 60);
/// How much of a resumed call the agent is told: the last this many lines.
const RESUME_LINES: i64 = 50;

/// The agents the current call opened with. Every token for that call carries the same
/// ones, so a reconnect mid-call never hands the voice agent a different list, whatever
/// looking for agents finds meanwhile (`agents::Agents`). The app runs one call at a time
/// (one LiveKit session), so opening the next one replaces it.
#[derive(Default)]
pub struct CallAgents(Mutex<Option<CurrentCall>>);

/// A call id and the agents, by id with their programs, it opened with.
type CurrentCall = (i64, Vec<(String, PathBuf)>);

impl CallAgents {
    fn set(&self, call_id: i64, agents: Vec<(String, PathBuf)>) {
        *self.lock() = Some((call_id, agents));
    }

    fn get(&self, call_id: i64) -> Option<Vec<(String, PathBuf)>> {
        self.lock()
            .as_ref()
            .filter(|(id, _)| *id == call_id)
            .map(|(_, agents)| agents.clone())
    }

    fn lock(&self) -> MutexGuard<'_, Option<CurrentCall>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// What the page needs to join the call.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallToken {
    server_url: String,
    participant_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    id: i64,
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

/// The job metadata the agent reads: the project (`Project.from_job` in
/// `agent/project.py`), the agents found on this computer by id with their programs, the
/// voice and, on a resumed call, the conversation so far (`CallOptions.from_job` in
/// `agent/call_options.py`).
fn dispatch_metadata(
    project: &projects::Project,
    agents: &[(String, PathBuf)],
    voice: &str,
    history: &[HistoryLine],
) -> String {
    let agents: serde_json::Map<_, _> = agents
        .iter()
        .map(|(id, path)| (id.clone(), path.display().to_string().into()))
        .collect();
    serde_json::json!({
        "project": project.name,
        "folders": project.folders,
        "agents": agents,
        "voice": voice,
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

fn livekit_keys<R: Runtime>(
    app: &AppHandle<R>,
    vault: &credentials::Vault,
) -> Result<credentials::LiveKitKeys> {
    vault
        .livekit(app)?
        .ok_or_else(|| Error::Invalid("Add your LiveKit keys in Settings first.".into()))
}

fn token(keys: &credentials::LiveKitKeys, room: &str, metadata: String) -> Result<String> {
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
pub fn open_call<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    worker: State<'_, AgentWorker>,
    vault: State<'_, credentials::Vault>,
    call_agents: State<'_, CallAgents>,
    project_id: i64,
    resume_call_id: Option<i64>,
) -> Result<i64> {
    projects::load(&db.conn(), project_id)?;
    let keys = livekit_keys(&app, &vault)?;
    let gemini = vault
        .gemini_key(&app)?
        .ok_or_else(|| Error::Invalid("Add your Gemini API key in Settings first.".into()))?;
    // Looks again, so an agent installed since launch is picked up; only where the programs
    // are, not their versions or sign-in.
    let found = agents::installed_now(&app);
    if found.is_empty() {
        return Err(Error::Invalid(
            "Bomby can't find an agent to work with. See Settings, Agents.".into(),
        ));
    }
    let log_dir = app.path().app_log_dir()?;
    worker.ensure(WorkerConfig::new(keys, gemini), &log_dir)?;

    let conn = db.conn();
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
    call_agents.set(call_id, found);
    Ok(call_id)
}

/// A token for a new room on the call, dispatching the agent with the project, the voice and
/// the call's last lines (none on a new call). It only reads: LiveKit's session fetches
/// tokens on its own too (on mount, and on end and disconnects, to have the next one ready),
/// so getting one must not change anything (docs/livekit-notes.md).
#[tauri::command(async)]
pub fn call_token<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    vault: State<'_, credentials::Vault>,
    found: State<'_, agents::Agents>,
    call_agents: State<'_, CallAgents>,
    call_id: i64,
) -> Result<CallToken> {
    let keys = livekit_keys(&app, &vault)?;
    let (project, history, voice) = {
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
            projects::load(&conn, project_id)?,
            recent_lines(&conn, call_id)?,
            settings::voice(&conn)?,
        )
    };
    // A new room every time, also when resuming. Unique across reinstalls too, since row
    // ids start over with a new database.
    let room = format!("bomby-{call_id}-{}", now_ms());
    // A call opened in this run has its own list; any other gets the last one found.
    let agents = call_agents
        .get(call_id)
        .unwrap_or_else(|| agents::installed(&found.cached().unwrap_or_default()));
    let metadata = dispatch_metadata(&project, &agents, &voice, &history);
    Ok(CallToken {
        participant_token: token(&keys, &room, metadata)?,
        server_url: keys.url,
    })
}

#[tauri::command(async)]
pub fn end_call(db: State<'_, Db>, call_id: i64) -> Result<()> {
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
    use super::*;

    #[test]
    fn the_current_call_keeps_its_agents_until_the_next_one_opens() {
        let agents = CallAgents::default();
        let claude = vec![(
            "claude".to_owned(),
            PathBuf::from("/Users/me/.local/bin/claude"),
        )];
        agents.set(1, claude.clone());
        assert_eq!(agents.get(1), Some(claude));
        assert_eq!(agents.get(2), None);

        agents.set(2, vec![]);
        assert_eq!(agents.get(1), None);
        assert_eq!(agents.get(2), Some(vec![]));
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
    fn the_metadata_carries_the_project_agents_voice_and_history() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        conn.execute(
            "INSERT INTO projects (name, created_at) VALUES ('samba', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO project_folders (project_id, position, path) VALUES (1, 0, '/tmp')",
            [],
        )
        .unwrap();
        let project = projects::load(&conn, 1).unwrap();
        let history = [HistoryLine {
            role: "agent".into(),
            text: "Hi.".into(),
        }];
        let agents = [("claude".to_owned(), PathBuf::from("/usr/local/bin/claude"))];
        let metadata: serde_json::Value =
            serde_json::from_str(&dispatch_metadata(&project, &agents, "Kore", &history)).unwrap();
        assert_eq!(
            metadata,
            serde_json::json!({
                "project": "samba",
                "folders": ["/tmp"],
                "agents": { "claude": "/usr/local/bin/claude" },
                "voice": "Kore",
                "history": [{ "role": "agent", "text": "Hi." }],
            })
        );
    }

    #[test]
    fn the_token_joins_the_room_and_dispatches_the_agent_with_the_project() {
        let keys = credentials::LiveKitKeys {
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
}
