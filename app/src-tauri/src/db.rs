//! The app's one SQLite database (docs/decisions/app-data-in-one-sqlite-db.md), in the app
//! data folder. The core is its only reader and writer; the page goes through commands.

use std::path::Path;

use rusqlite::Connection;

use crate::error::Result;
use crate::sync::{Exclusive, ExclusiveGuard};

pub const FILE_NAME: &str = "bomby.db";

/// Schema changes, in order. Each runs once; `PRAGMA user_version` records how many have
/// run. Never edit a shipped migration: add a new one.
const MIGRATIONS: &[&str] = &[
    // 1: projects, their folders, calls, and what was said in each call.
    "
    CREATE TABLE projects (
        id         INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        created_at INTEGER NOT NULL
    );
    -- A project's folders in order; position 0 is Claude's working directory.
    CREATE TABLE project_folders (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        position   INTEGER NOT NULL,
        path       TEXT    NOT NULL,
        PRIMARY KEY (project_id, position)
    );
    CREATE TABLE calls (
        id         INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER
    );
    CREATE INDEX calls_by_project ON calls(project_id, started_at);
    -- One transcript line. role: 'user' or 'agent'.
    CREATE TABLE messages (
        id         INTEGER PRIMARY KEY,
        call_id    INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
        role       TEXT    NOT NULL,
        text       TEXT    NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX messages_by_call ON messages(call_id, created_at);
    ",
    // 2: a transcript line's LiveKit segment id, so a line that grows while it is spoken is
    // saved once and updated in place.
    "
    ALTER TABLE messages ADD COLUMN segment_id TEXT;
    CREATE UNIQUE INDEX messages_by_segment ON messages(call_id, segment_id);
    ",
    // 3: app settings that aren't secrets (the agent's voice), one row per key.
    "
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    ",
    // 4: what the user wrote about a project, for the voice agent and the coding agents;
    // empty when they wrote nothing.
    "
    ALTER TABLE projects ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
    ",
    // 5: the session settings the user picked for each agent (its model, effort, goose's
    // provider), in the order they're applied. None for an agent on its own defaults.
    "
    CREATE TABLE agent_picks (
        agent    TEXT    NOT NULL,
        position INTEGER NOT NULL,
        setting  TEXT    NOT NULL,
        value    TEXT    NOT NULL,
        PRIMARY KEY (agent, position)
    );
    ",
    // 6: which agents a project's calls can hand work to. Off: none. On, with no rows:
    // every agent that's set up; with rows: only those.
    "
    ALTER TABLE projects ADD COLUMN agents_on INTEGER NOT NULL DEFAULT 1;
    CREATE TABLE project_agents (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent      TEXT    NOT NULL,
        PRIMARY KEY (project_id, agent)
    );
    ",
    // 7: extensions (docs/decisions/extensions.md). Which a project's calls have: those on
    // in Settings unless it picks its own, then the rows it has; extensions_picked once it
    // has picked, so a pick of none stays none and only a first pick starts from Settings'. And its to-dos, each with a
    // number of its own in the project, counted by `todos_made` so none is reused. status:
    // 'todo', 'doing', 'done' or 'cancelled'; created_by and updated_by: 'user' or 'bomby'.
    "
    ALTER TABLE projects ADD COLUMN extensions_own INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE projects ADD COLUMN extensions_picked INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE project_extensions (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        extension  TEXT    NOT NULL,
        PRIMARY KEY (project_id, extension)
    );
    ALTER TABLE projects ADD COLUMN todos_made INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE todos (
        id         INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        number     INTEGER NOT NULL,
        title      TEXT    NOT NULL,
        notes      TEXT    NOT NULL DEFAULT '',
        status     TEXT    NOT NULL,
        created_by TEXT    NOT NULL,
        updated_by TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        done_at    INTEGER,
        UNIQUE (project_id, number)
    );
    ",
    // 8: what was said in calls, indexed for search (search.rs): FTS5 over messages' text,
    // by trigrams, so any part of a word in any language matches, any case and accents
    // aside. The triggers keep it current as lines are saved, grow and go with their call.
    "
    CREATE VIRTUAL TABLE messages_search USING fts5(
        text, content = 'messages', content_rowid = 'id',
        tokenize = 'trigram remove_diacritics 1'
    );
    INSERT INTO messages_search (messages_search) VALUES ('rebuild');
    CREATE TRIGGER messages_search_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_search (rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER messages_search_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_search (messages_search, rowid, text)
        VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER messages_search_update AFTER UPDATE OF text ON messages BEGIN
        INSERT INTO messages_search (messages_search, rowid, text)
        VALUES ('delete', old.id, old.text);
        INSERT INTO messages_search (rowid, text) VALUES (new.id, new.text);
    END;
    ",
    // 9: a call's name and its sessions (docs/decisions/call-names-and-sessions.md). name:
    // null until the user or Bomby names it; named_by: 'user' or 'bomby'. A session is one
    // stretch of a call, from opening or resuming it to its end, and each line says which
    // it was said in. Calls from before have one session, from their start to their end,
    // with all their lines: earlier resumes left no trace to split them by.
    "
    ALTER TABLE calls ADD COLUMN name TEXT;
    ALTER TABLE calls ADD COLUMN named_by TEXT;
    CREATE TABLE call_sessions (
        id         INTEGER PRIMARY KEY,
        call_id    INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER
    );
    CREATE INDEX call_sessions_by_call ON call_sessions(call_id, started_at);
    ALTER TABLE messages ADD COLUMN session_id INTEGER REFERENCES call_sessions(id);
    INSERT INTO call_sessions (call_id, started_at, ended_at)
        SELECT id, started_at, ended_at FROM calls;
    UPDATE messages SET session_id =
        (SELECT s.id FROM call_sessions s WHERE s.call_id = messages.call_id);
    ",
    // 10: a session's lines by index, for ending one the app quit during (calls.rs,
    // `begin_session`). Apart from 9, which a development build may have run without it.
    "
    CREATE INDEX IF NOT EXISTS messages_by_session ON messages(session_id, created_at);
    ",
    // 11: launch checks remembered across launches (agent_checks.rs,
    // docs/decisions/remember-the-launch-check.md): an agent's last ready setup, as JSON, and
    // what it depended on (its program, setup files, picks and saved keys' names, never a key).
    "
    CREATE TABLE agent_checks (
        agent       TEXT    PRIMARY KEY,
        setup       TEXT    NOT NULL,
        fingerprint TEXT    NOT NULL,
        checked_at  INTEGER NOT NULL
    );
    ",
    // 12: the key fields each agent's row last offered from a session (agent_key_fields.rs),
    // as JSON: variable names and labels, never a key.
    "
    CREATE TABLE agent_key_fields (
        agent  TEXT PRIMARY KEY,
        fields TEXT NOT NULL
    );
    ",
];

/// The open database, shared by every command through Tauri state. One thread can't take it
/// twice ([`Exclusive`]): take it once into a `let` and pass the connection down.
pub struct Db(Exclusive<Connection>);

impl Db {
    /// Opens (creating if needed) the database file and brings its schema up to date.
    pub fn open(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    /// Whether this thread holds the connection now.
    #[cfg(test)]
    pub fn held_here(&self) -> bool {
        self.0.held_here()
    }

    fn init(mut conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", true)?;
        // WAL keeps reads fast while a call writes transcript lines. In-memory stays "memory".
        conn.pragma_update(None, "journal_mode", "WAL")?;
        crate::search::add_fold(&conn)?;
        migrate(&mut conn)?;
        Ok(Self(Exclusive::new("the database", conn)))
    }

    /// The connection, once no other thread holds it. Fails at once, never waits, when this
    /// thread holds it already (in debug builds and tests it panics).
    pub fn conn(&self) -> Result<ExclusiveGuard<'_, Connection>> {
        // A panic while holding the lock leaves the connection usable; carry on.
        self.0.lock()
    }
}

fn migrate(conn: &mut Connection) -> Result<()> {
    let applied: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    for (version, sql) in (1_i64..).zip(MIGRATIONS) {
        if version <= applied {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

/// Milliseconds since the Unix epoch, the unit of every timestamp column.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_once_and_records_the_version() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(usize::try_from(version).unwrap(), MIGRATIONS.len());
        // Running again is a no-op.
        migrate(&mut conn).unwrap();
    }

    #[test]
    fn calls_from_before_sessions_get_one_with_all_their_lines() {
        let conn = Connection::open_in_memory().unwrap();
        for sql in &MIGRATIONS[..8] {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", 8).unwrap();
        conn.execute_batch(
            "INSERT INTO projects (name, created_at) VALUES ('samba', 0);
             INSERT INTO calls (project_id, started_at, ended_at) VALUES (1, 10, 90);
             INSERT INTO calls (project_id, started_at) VALUES (1, 100);
             INSERT INTO messages (call_id, segment_id, role, text, created_at)
                 VALUES (1, 'a', 'user', 'hi', 20), (1, 'b', 'agent', 'hello', 30),
                        (2, 'c', 'user', 'again', 110);",
        )
        .unwrap();
        let mut conn = conn;
        migrate(&mut conn).unwrap();

        let sessions: Vec<(i64, i64, i64, Option<i64>)> = conn
            .prepare("SELECT id, call_id, started_at, ended_at FROM call_sessions ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(sessions, [(1, 1, 10, Some(90)), (2, 2, 100, None)]);
        let lines: Vec<(String, i64)> = conn
            .prepare("SELECT text, session_id FROM messages ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            lines,
            [("hi".into(), 1), ("hello".into(), 1), ("again".into(), 2)]
        );
    }
}
