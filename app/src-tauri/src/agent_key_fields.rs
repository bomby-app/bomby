//! The key fields each agent's row last offered from a session, kept across launches: a
//! check that fails before a session (goose timing out while macOS asks for its keychain
//! password) still offers the field it offered last time, so the key that stops the asking
//! can be saved. Names and labels only, never a key.
//!
//! Only a session's answer is kept, and it always replaces what was kept: the fields follow
//! the agent's own setup (goose's provider), which a session reads. One that names no keys
//! (a provider that signs in another way) forgets them. A failure changes nothing. Apart from
//! the remembered launch check (`agent_checks`), which a failure forgets.

use std::collections::HashMap;

use rusqlite::{Connection, params};

use crate::error::{Error, Result};
use crate::setup::{KeyField, Setup};

/// Every agent's kept key fields. One that can't be read is left out: its row shows what
/// the probe found.
pub fn all(conn: &Connection) -> Result<HashMap<String, Vec<KeyField>>> {
    let mut rows = conn.prepare("SELECT agent, fields FROM agent_key_fields")?;
    let found = rows.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut kept = HashMap::new();
    for row in found {
        let (agent, fields) = row?;
        // A `KeyField` writes camelCase and reads snake_case; its fields are one word each,
        // so it reads back what it wrote.
        if let Ok(fields) = serde_json::from_str::<Vec<KeyField>>(&fields) {
            kept.insert(agent, fields);
        }
    }
    Ok(kept)
}

/// Keeps the key fields `setup`, an answer about `agent`, offers, if it came from a session.
pub fn record(conn: &Connection, agent: &str, setup: &Setup) -> Result<()> {
    if !setup.session {
        return Ok(());
    }
    if setup.keys.is_empty() {
        conn.execute("DELETE FROM agent_key_fields WHERE agent = ?1", [agent])?;
        return Ok(());
    }
    let fields = serde_json::to_string(&setup.keys).map_err(Error::Corrupt)?;
    conn.execute(
        "INSERT INTO agent_key_fields (agent, fields) VALUES (?1, ?2)
         ON CONFLICT (agent) DO UPDATE SET fields = excluded.fields",
        params![agent, fields],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::setup::Step;

    fn field(name: &str, label: &str) -> KeyField {
        KeyField {
            name: name.into(),
            label: label.into(),
            secret: true,
            optional: false,
        }
    }

    fn answer(session: bool, keys: Vec<KeyField>) -> Setup {
        Setup {
            step: if session {
                Step::Ready
            } else {
                Step::Unreachable
            },
            session,
            keys,
            ..Setup::default()
        }
    }

    #[test]
    fn a_sessions_fields_are_kept_replaced_and_forgotten_only_by_another_session() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        let openrouter = field("OPENROUTER_API_KEY", "OpenRouter API key");
        let anthropic = field("ANTHROPIC_API_KEY", "Anthropic API key");

        record(&conn, "goose", &answer(true, vec![openrouter.clone()])).unwrap();
        assert_eq!(all(&conn).unwrap()["goose"], vec![openrouter.clone()]);

        // A failure names other keys, or none: what a session found stays.
        record(&conn, "goose", &answer(false, vec![])).unwrap();
        record(&conn, "goose", &answer(false, vec![anthropic.clone()])).unwrap();
        assert_eq!(all(&conn).unwrap()["goose"], vec![openrouter]);

        // The provider changed: the next session's fields replace them.
        record(&conn, "goose", &answer(true, vec![anthropic.clone()])).unwrap();
        assert_eq!(all(&conn).unwrap()["goose"], vec![anthropic]);

        // A provider that takes no key: nothing to offer any more.
        record(&conn, "goose", &answer(true, vec![])).unwrap();
        assert!(!all(&conn).unwrap().contains_key("goose"));
    }

    #[test]
    fn fields_that_cant_be_read_are_left_out() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        conn.execute(
            "INSERT INTO agent_key_fields (agent, fields) VALUES ('goose', 'not json')",
            [],
        )
        .unwrap();

        assert!(all(&conn).unwrap().is_empty());
    }
}
