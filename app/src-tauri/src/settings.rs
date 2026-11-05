//! App settings that aren't secrets, kept in the database's `settings` table: the agent's
//! voice and what the user likes to be called, both sent with every call
//! (`calls::call_token`), and whether the first run is done.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::error::{Error, Result};

const VOICE_KEY: &str = "voice";
/// What the user likes to be called; empty or missing when they'd rather not say.
const USER_NAME_KEY: &str = "user_name";
const MAX_USER_NAME_LEN: usize = 50;
/// Set once the first-run splash has set up an agent.
const FIRST_RUN_KEY: &str = "first_run_done";

/// Used when none is chosen: the voice the agent has always had (`agent/call_options.py`).
pub const DEFAULT_VOICE: &str = "Charon";

/// Gemini's 30 prebuilt voices: name, style and pitch, as Google lists them for Gemini 3.8
/// (ai.google.dev/gemini-api/docs/speech-generation#voices, and AI Studio for the pitch,
/// 2026-11-04). Live supports all of them. The larger voice library and custom voices
/// (`GET /v1beta/voices`) are left out on purpose.
pub const VOICES: [(&str, &str, &str); 30] = [
    ("Zephyr", "Bright", "Higher"),
    ("Puck", "Upbeat", "Middle"),
    ("Charon", "Informative", "Lower"),
    ("Kore", "Firm", "Middle"),
    ("Fenrir", "Excitable", "Lower middle"),
    ("Leda", "Youthful", "Higher"),
    ("Orus", "Firm", "Lower middle"),
    ("Aoede", "Breezy", "Middle"),
    ("Callirrhoe", "Easy-going", "Middle"),
    ("Autonoe", "Bright", "Middle"),
    ("Enceladus", "Breathy", "Lower"),
    ("Iapetus", "Clear", "Lower middle"),
    ("Umbriel", "Easy-going", "Lower middle"),
    ("Algieba", "Smooth", "Lower"),
    ("Despina", "Smooth", "Middle"),
    ("Erinome", "Clear", "Middle"),
    ("Algenib", "Gravelly", "Lower"),
    ("Rasalgethi", "Informative", "Middle"),
    ("Laomedeia", "Upbeat", "Higher"),
    ("Achernar", "Soft", "Higher"),
    ("Alnilam", "Firm", "Lower middle"),
    ("Schedar", "Even", "Lower middle"),
    ("Gacrux", "Mature", "Middle"),
    ("Pulcherrima", "Forward", "Middle"),
    ("Achird", "Friendly", "Lower middle"),
    ("Zubenelgenubi", "Casual", "Lower middle"),
    ("Vindemiatrix", "Gentle", "Middle"),
    ("Sadachbia", "Lively", "Lower"),
    ("Sadaltager", "Knowledgeable", "Middle"),
    ("Sulafat", "Warm", "Middle"),
];

#[derive(Serialize)]
pub struct Voice {
    name: &'static str,
    style: &'static str,
    pitch: &'static str,
}

#[derive(Serialize)]
pub struct VoiceSettings {
    voice: String,
    voices: Vec<Voice>,
}

/// The value saved under `key`, if any.
fn get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?)
}

/// Saves `value` under `key`, replacing what was there.
fn put(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// The settings a call takes along (`calls::dispatch_metadata`).
pub(crate) struct CallSettings {
    pub(crate) voice: String,
    /// Empty when the user hasn't given one.
    pub(crate) user_name: String,
}

pub(crate) fn for_call(conn: &Connection) -> Result<CallSettings> {
    Ok(CallSettings {
        voice: voice(conn)?,
        user_name: read_user_name(conn)?,
    })
}

/// The chosen voice, or the default.
fn voice(conn: &Connection) -> Result<String> {
    Ok(get(conn, VOICE_KEY)?.unwrap_or_else(|| DEFAULT_VOICE.to_owned()))
}

fn save_voice(conn: &Connection, name: &str) -> Result<()> {
    if !VOICES.iter().any(|(voice, _, _)| *voice == name) {
        return Err(Error::Invalid(format!("{name} isn't a Gemini voice.")));
    }
    put(conn, VOICE_KEY, name)
}

#[tauri::command(async)]
pub fn voice_settings(db: State<'_, Db>) -> Result<VoiceSettings> {
    Ok(VoiceSettings {
        voice: voice(&db.conn())?,
        voices: VOICES
            .iter()
            .map(|&(name, style, pitch)| Voice { name, style, pitch })
            .collect(),
    })
}

#[tauri::command(async)]
pub fn set_voice(db: State<'_, Db>, name: String) -> Result<()> {
    save_voice(&db.conn(), &name)
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

#[tauri::command(async)]
pub fn user_name(db: State<'_, Db>) -> Result<String> {
    read_user_name(&db.conn())
}

#[tauri::command(async)]
pub fn set_user_name(db: State<'_, Db>, name: String) -> Result<String> {
    save_user_name(&db.conn(), &name)
}

/// Whether this is the first run: the splash shows until it has set up an agent.
#[tauri::command(async)]
pub fn first_run(db: State<'_, Db>) -> Result<bool> {
    Ok(get(&db.conn(), FIRST_RUN_KEY)?.is_none())
}

#[tauri::command(async)]
pub fn finish_first_run(db: State<'_, Db>) -> Result<()> {
    put(&db.conn(), FIRST_RUN_KEY, "1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_charon_and_keeps_a_chosen_voice() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        assert_eq!(voice(&conn).unwrap(), DEFAULT_VOICE);
        save_voice(&conn, "Kore").unwrap();
        save_voice(&conn, "Sulafat").unwrap();
        assert_eq!(voice(&conn).unwrap(), "Sulafat");
    }

    #[test]
    fn rejects_a_voice_gemini_doesnt_have() {
        let db = Db::in_memory().unwrap();
        assert!(matches!(
            save_voice(&db.conn(), "Hal"),
            Err(Error::Invalid(_))
        ));
    }

    #[test]
    fn keeps_the_users_name_trimmed_and_lets_it_be_cleared() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
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
    fn rejects_a_name_too_long_to_say() {
        let db = Db::in_memory().unwrap();
        let long = "x".repeat(MAX_USER_NAME_LEN + 1);
        assert!(matches!(
            save_user_name(&db.conn(), &long),
            Err(Error::Invalid(_))
        ));
    }
}
