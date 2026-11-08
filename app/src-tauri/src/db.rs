//! The app's one SQLite database (docs/decisions/app-data-in-one-sqlite-db.md), in the app
//! data folder. The core is its only reader and writer; the page goes through commands.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::Result;
use crate::sync;

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
];

/// The open database, shared by every command through Tauri state.
pub struct Db(Mutex<Connection>);

impl Db {
    /// Opens (creating if needed) the database file and brings its schema up to date.
    pub fn open(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", true)?;
        // WAL keeps reads fast while a call writes transcript lines. In-memory stays "memory".
        conn.pragma_update(None, "journal_mode", "WAL")?;
        migrate(&mut conn)?;
        Ok(Self(Mutex::new(conn)))
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        // A panic while holding the lock leaves the connection usable; carry on.
        sync::lock(&self.0)
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
        let mut conn = db.conn();
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(usize::try_from(version).unwrap(), MIGRATIONS.len());
        // Running again is a no-op.
        migrate(&mut conn).unwrap();
    }
}
