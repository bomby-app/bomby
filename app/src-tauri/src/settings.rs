//! App settings that aren't secrets, kept in the database's `settings` table. For now the
//! agent's voice, sent with every call (`calls::call_token`).

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::error::{Error, Result};

const VOICE_KEY: &str = "voice";

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

/// The chosen voice, or the default.
pub fn voice(conn: &Connection) -> Result<String> {
    let saved: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [VOICE_KEY],
            |row| row.get(0),
        )
        .optional()?;
    Ok(saved.unwrap_or_else(|| DEFAULT_VOICE.to_owned()))
}

fn set(conn: &Connection, name: &str) -> Result<()> {
    if !VOICES.iter().any(|(voice, _, _)| *voice == name) {
        return Err(Error::Invalid(format!("{name} isn't a Gemini voice.")));
    }
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![VOICE_KEY, name],
    )?;
    Ok(())
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
    set(&db.conn(), &name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_charon_and_keeps_a_chosen_voice() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        assert_eq!(voice(&conn).unwrap(), DEFAULT_VOICE);
        set(&conn, "Kore").unwrap();
        set(&conn, "Sulafat").unwrap();
        assert_eq!(voice(&conn).unwrap(), "Sulafat");
    }

    #[test]
    fn rejects_a_voice_gemini_doesnt_have() {
        let db = Db::in_memory().unwrap();
        assert!(matches!(set(&db.conn(), "Hal"), Err(Error::Invalid(_))));
    }
}
