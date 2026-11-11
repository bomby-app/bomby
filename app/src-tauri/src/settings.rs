//! App settings that aren't secrets, kept in the database's `settings` table: what the user
//! likes to be called and the tone they prefer, both sent with every call
//! (`calls::call_token`), memory across calls, the LiveKit server, and whether the first run
//! is done. The voice provider, its voice and options are `voice.rs`'s.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::blocking::blocking;
use crate::db::Db;
use crate::error::{Error, Result};

/// What the user likes to be called; empty or missing when they'd rather not say.
const USER_NAME_KEY: &str = "user_name";
const MAX_USER_NAME_LEN: usize = 50;
const TONE_KEY: &str = "tone";
const MEMORY_KEY: &str = "memory";
/// This install's user in Zep, made once.
const MEMORY_USER_KEY: &str = "memory_user";
/// Read memory, save nothing ("1"); missing or anything else is off.
const INCOGNITO_KEY: &str = "memory_incognito";

/// Whether Bomby remembers the user across calls. A resumed call replays its last lines
/// either way.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "memory.ts"))]
pub enum Memory {
    #[default]
    Off,
    /// In the user's own Zep project.
    Zep,
}

/// How Bomby talks: each picks its own voice prompt (`agent/prompts/<provider>/<tone>.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "voice.ts"))]
pub enum Tone {
    #[default]
    Sharp,
    Chatty,
    Playful,
}

impl Tone {
    fn as_str(self) -> &'static str {
        match self {
            Self::Sharp => "sharp",
            Self::Chatty => "chatty",
            Self::Playful => "playful",
        }
    }
}
/// Set once the first-run splash has set up an agent.
const FIRST_RUN_KEY: &str = "first_run_done";
const LIVEKIT_SERVER_KEY: &str = "livekit_server";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "credentials.ts"))]
pub enum LiveKitServer {
    ThisMac,
    /// LiveKit Cloud or a server they run, with their keys.
    Theirs,
}

impl LiveKitServer {
    fn as_str(self) -> &'static str {
        match self {
            Self::ThisMac => "this_mac",
            Self::Theirs => "theirs",
        }
    }
}

/// The value saved under `key`, if any.
pub(crate) fn get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?)
}

/// Saves `value` under `key`, replacing what was there.
pub(crate) fn put(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// The settings a call takes along (`calls::dispatch_metadata`).
pub(crate) struct CallSettings {
    /// Empty when the user hasn't given one.
    pub(crate) user_name: String,
    pub(crate) tone: Tone,
}

pub(crate) fn for_call(conn: &Connection) -> Result<CallSettings> {
    Ok(CallSettings {
        user_name: read_user_name(conn)?,
        tone: read_tone(conn)?,
    })
}

/// What the user likes to be called, or empty.
fn read_user_name(conn: &Connection) -> Result<String> {
    Ok(get(conn, USER_NAME_KEY)?.unwrap_or_default())
}

/// Saves the name trimmed, and returns it as saved; an empty one clears it.
fn save_user_name(conn: &Connection, name: &str) -> Result<String> {
    let name = name.trim();
    if name.chars().count() > MAX_USER_NAME_LEN {
        return Err(Error::Invalid(format!(
            "Keep your name under {MAX_USER_NAME_LEN} characters."
        )));
    }
    put(conn, USER_NAME_KEY, name)?;
    Ok(name.to_owned())
}

#[tauri::command]
pub async fn user_name<R: Runtime>(app: AppHandle<R>) -> Result<String> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        read_user_name(&*db.conn()?)
    })
    .await
}

#[tauri::command]
pub async fn set_user_name<R: Runtime>(app: AppHandle<R>, name: String) -> Result<String> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        save_user_name(&*db.conn()?, &name)
    })
    .await
}

/// Until chosen: theirs if their keys are saved, so existing installs stay on them. Saved
/// on first read, so removing the keys later doesn't switch calls to this Mac.
pub(crate) fn livekit_server(conn: &Connection, has_their_keys: bool) -> Result<LiveKitServer> {
    match get(conn, LIVEKIT_SERVER_KEY)?.as_deref() {
        Some("this_mac") => Ok(LiveKitServer::ThisMac),
        Some("theirs") => Ok(LiveKitServer::Theirs),
        _ => {
            let server = if has_their_keys {
                LiveKitServer::Theirs
            } else {
                LiveKitServer::ThisMac
            };
            save_livekit_server(conn, server)?;
            Ok(server)
        }
    }
}

pub(crate) fn save_livekit_server(conn: &Connection, server: LiveKitServer) -> Result<()> {
    put(conn, LIVEKIT_SERVER_KEY, server.as_str())
}

pub(crate) fn memory(conn: &Connection) -> Result<Memory> {
    Ok(match get(conn, MEMORY_KEY)?.as_deref() {
        Some("zep") => Memory::Zep,
        _ => Memory::Off,
    })
}

pub(crate) fn incognito(conn: &Connection) -> Result<bool> {
    Ok(get(conn, INCOGNITO_KEY)?.as_deref() == Some("1"))
}

#[tauri::command]
pub async fn memory_incognito<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        incognito(&*db.conn()?)
    })
    .await
}

/// Applies from the next call.
#[tauri::command]
pub async fn set_memory_incognito<R: Runtime>(app: AppHandle<R>, on: bool) -> Result<()> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        put(&*db.conn()?, INCOGNITO_KEY, if on { "1" } else { "0" })
    })
    .await
}

/// This install's id in Zep: one user, made the first time it's needed.
pub(crate) fn memory_user(conn: &Connection) -> Result<String> {
    if let Some(id) = get(conn, MEMORY_USER_KEY)? {
        return Ok(id);
    }
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes)
        .map_err(|e| Error::Invalid(format!("Couldn't make the memory id: {e}")))?;
    let id = format!(
        "bomby-{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    );
    put(conn, MEMORY_USER_KEY, &id)?;
    Ok(id)
}

#[tauri::command]
pub async fn memory_setting<R: Runtime>(app: AppHandle<R>) -> Result<Memory> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        memory(&*db.conn()?)
    })
    .await
}

/// Applies from the next call.
#[tauri::command]
pub async fn set_memory_setting<R: Runtime>(app: AppHandle<R>, memory: Memory) -> Result<()> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        let value = match memory {
            Memory::Off => "off",
            Memory::Zep => "zep",
        };
        put(&*db.conn()?, MEMORY_KEY, value)
    })
    .await
}

fn read_tone(conn: &Connection) -> Result<Tone> {
    Ok(match get(conn, TONE_KEY)?.as_deref() {
        Some("chatty") => Tone::Chatty,
        Some("playful") => Tone::Playful,
        _ => Tone::Sharp,
    })
}

#[tauri::command]
pub async fn tone<R: Runtime>(app: AppHandle<R>) -> Result<Tone> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        read_tone(&*db.conn()?)
    })
    .await
}

#[tauri::command]
pub async fn set_tone<R: Runtime>(app: AppHandle<R>, tone: Tone) -> Result<()> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        put(&*db.conn()?, TONE_KEY, tone.as_str())
    })
    .await
}

/// Whether this is the first run: the splash shows until the user finishes it, with the
/// keys in and an agent ready or left for later; in development, `just app dev --splash`
/// shows it at every launch ([`dev`](crate::dev)).
#[tauri::command]
pub async fn first_run<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        Ok(crate::dev::always_splash() || get(&*db.conn()?, FIRST_RUN_KEY)?.is_none())
    })
    .await
}

#[tauri::command]
pub async fn finish_first_run<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        put(&*db.conn()?, FIRST_RUN_KEY, "1")
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_users_name_trimmed_and_lets_it_be_cleared() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        assert_eq!(
            read_user_name(&conn).unwrap(),
            "",
            "no name until one is given"
        );

        assert_eq!(save_user_name(&conn, "  Sam ").unwrap(), "Sam");
        assert_eq!(for_call(&conn).unwrap().user_name, "Sam");

        assert_eq!(save_user_name(&conn, "   ").unwrap(), "");
        assert_eq!(read_user_name(&conn).unwrap(), "");
    }

    #[test]
    fn keeps_their_livekit_until_the_user_chooses() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        assert_eq!(livekit_server(&conn, true).unwrap(), LiveKitServer::Theirs);
        // Saved once worked out: removing the keys later keeps it.
        assert_eq!(livekit_server(&conn, false).unwrap(), LiveKitServer::Theirs);

        let fresh = Db::in_memory().unwrap();
        assert_eq!(
            livekit_server(&fresh.conn().unwrap(), false).unwrap(),
            LiveKitServer::ThisMac
        );

        save_livekit_server(&conn, LiveKitServer::ThisMac).unwrap();
        assert_eq!(livekit_server(&conn, true).unwrap(), LiveKitServer::ThisMac);
        save_livekit_server(&conn, LiveKitServer::Theirs).unwrap();
        assert_eq!(livekit_server(&conn, false).unwrap(), LiveKitServer::Theirs);
    }

    #[test]
    fn the_tone_is_sharp_until_one_is_chosen() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        assert_eq!(for_call(&conn).unwrap().tone, Tone::Sharp);
        put(&conn, TONE_KEY, Tone::Playful.as_str()).unwrap();
        assert_eq!(for_call(&conn).unwrap().tone, Tone::Playful);
    }

    #[test]
    fn memory_is_off_until_turned_on_and_its_user_is_made_once() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        assert_eq!(memory(&conn).unwrap(), Memory::Off);
        put(&conn, MEMORY_KEY, "zep").unwrap();
        assert_eq!(memory(&conn).unwrap(), Memory::Zep);

        assert!(!incognito(&conn).unwrap());
        put(&conn, INCOGNITO_KEY, "1").unwrap();
        assert!(incognito(&conn).unwrap());

        let first = memory_user(&conn).unwrap();
        assert!(first.starts_with("bomby-") && first.len() == 22, "{first}");
        assert_eq!(memory_user(&conn).unwrap(), first);
    }

    #[test]
    fn rejects_a_name_too_long_to_say() {
        let db = Db::in_memory().unwrap();
        let long = "x".repeat(MAX_USER_NAME_LEN + 1);
        assert!(matches!(
            save_user_name(&db.conn().unwrap(), &long),
            Err(Error::Invalid(_))
        ));
    }
}
