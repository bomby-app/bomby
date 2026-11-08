//! Projects: a name, the folders the agents work in if any (the first is the working
//! directory; with none, the home folder),
//! what the user wrote about the project, its agents and extensions, and its calls. The sidebar tree is `list_projects`.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{Db, now_ms};
use crate::error::{Error, Result};
use crate::extensions::{self, ProjectExtensions};

const MAX_NAME_LEN: usize = 80;
/// Room for a good description of a project, about 1,250 tokens of English, without
/// crowding the voice agent's instructions or the coding agents' briefing.
pub(crate) const MAX_INSTRUCTIONS_LEN: usize = 5000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "projects.ts"))]
pub struct Project {
    id: i64,
    name: String,
    folders: Vec<String>,
    /// What the user wrote about the project; empty if nothing.
    instructions: String,
    agents: ProjectAgents,
    extensions: ProjectExtensions,
    created_at: i64,
    /// Newest first.
    calls: Vec<CallSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "projects.ts"))]
pub struct CallSummary {
    id: i64,
    started_at: i64,
    ended_at: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "projects.ts"))]
pub struct ProjectInput {
    name: String,
    folders: Vec<String>,
    #[serde(default)]
    instructions: String,
}

/// Which agents a project's calls can hand work to (Project settings, Agents). Saved as it
/// changes, apart from the name, folders and instructions (`set_project_agents`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "projects.ts"))]
pub struct ProjectAgents {
    /// Off: the project's calls talk, but hand nothing off.
    pub on: bool,
    /// Only these, by harness id; empty for every agent that's set up, including ones added
    /// later. Kept while off, for when it's on again.
    pub only: Vec<String>,
}

impl Default for ProjectAgents {
    fn default() -> Self {
        Self {
            on: true,
            only: Vec::new(),
        }
    }
}

impl ProjectAgents {
    /// Whether the project's calls can use the agent `id`. The call's own gate, the setup
    /// probe, still leaves out one that isn't ready (`agents::usable`).
    pub(crate) fn allows(&self, id: &str) -> bool {
        self.on && (self.only.is_empty() || self.only.iter().any(|a| a == id))
    }
}

/// A project as the page sent it, trimmed and checked.
struct Valid {
    name: String,
    folders: Vec<String>,
    instructions: String,
}

/// Trims and checks what the page sent. The folder rules match the agent's
/// (`agent/project.py`, `Project.from_job`): absolute paths to existing folders.
fn validate(input: ProjectInput) -> Result<Valid> {
    let name = input.name.trim().to_owned();
    if name.is_empty() {
        return Err(Error::Invalid("Give the project a name.".into()));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(Error::Invalid(format!(
            "Keep the name under {MAX_NAME_LEN} characters."
        )));
    }

    let mut seen = HashSet::new();
    let mut folders = Vec::with_capacity(input.folders.len());
    for folder in input.folders {
        let folder = folder.trim().to_owned();
        let path = Path::new(&folder);
        if !path.is_absolute() || !path.is_dir() {
            return Err(Error::Invalid(format!("{folder} isn't a folder.")));
        }
        if !seen.insert(folder.clone()) {
            return Err(Error::Invalid(format!("{folder} is listed twice.")));
        }
        folders.push(folder);
    }

    let instructions = input.instructions.trim().to_owned();
    if instructions.chars().count() > MAX_INSTRUCTIONS_LEN {
        return Err(Error::Invalid(format!(
            "Keep the instructions under {MAX_INSTRUCTIONS_LEN} characters."
        )));
    }
    Ok(Valid {
        name,
        folders,
        instructions,
    })
}

fn ensure_unique_name(conn: &Connection, name: &str, except: Option<i64>) -> Result<()> {
    let taken: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM projects WHERE name = ?1 AND id IS NOT ?2)",
        params![name, except],
        |row| row.get(0),
    )?;
    if taken {
        return Err(Error::Invalid(format!(
            "There's already a project called {name}."
        )));
    }
    Ok(())
}

fn write_folders(conn: &Connection, project_id: i64, folders: &[String]) -> Result<()> {
    conn.execute(
        "DELETE FROM project_folders WHERE project_id = ?1",
        [project_id],
    )?;
    let mut insert = conn
        .prepare("INSERT INTO project_folders (project_id, position, path) VALUES (?1, ?2, ?3)")?;
    for (position, path) in (0_i64..).zip(folders) {
        insert.execute(params![project_id, position, path])?;
    }
    Ok(())
}

/// What a call needs of a project: what it's called, where it lives and what the user
/// wrote about it.
pub(crate) struct CallProject {
    pub(crate) name: String,
    pub(crate) folders: Vec<String>,
    pub(crate) instructions: String,
    pub(crate) agents: ProjectAgents,
    pub(crate) extensions: ProjectExtensions,
}

/// The project's name, folders, instructions, agents and extensions, without its calls.
pub(crate) fn for_call(conn: &Connection, id: i64) -> Result<CallProject> {
    let (name, instructions) = conn
        .query_row(
            "SELECT name, instructions FROM projects WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(Error::NotFound("project"))?;
    Ok(CallProject {
        name,
        folders: folders(conn, id)?,
        instructions,
        agents: agents(conn, id)?,
        extensions: project_extensions(conn, id)?,
    })
}

fn agents(conn: &Connection, id: i64) -> Result<ProjectAgents> {
    let on: bool = conn
        .query_row(
            "SELECT agents_on FROM projects WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(Error::NotFound("project"))?;
    let only = conn
        .prepare("SELECT agent FROM project_agents WHERE project_id = ?1 ORDER BY agent")?
        .query_map([id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ProjectAgents { on, only })
}

fn save_agents(conn: &mut Connection, id: i64, agents: &ProjectAgents) -> Result<()> {
    if let Some(unknown) = agents.only.iter().find(|a| !crate::agents::is_known(a)) {
        return Err(Error::Invalid(format!(
            "Bomby has no agent called {unknown}."
        )));
    }
    let tx = conn.transaction()?;
    let changed = tx.execute(
        "UPDATE projects SET agents_on = ?1 WHERE id = ?2",
        params![agents.on, id],
    )?;
    if changed == 0 {
        return Err(Error::NotFound("project"));
    }
    tx.execute("DELETE FROM project_agents WHERE project_id = ?1", [id])?;
    let mut insert =
        tx.prepare("INSERT OR IGNORE INTO project_agents (project_id, agent) VALUES (?1, ?2)")?;
    for agent in &agents.only {
        insert.execute(params![id, agent])?;
    }
    drop(insert);
    tx.commit()?;
    Ok(())
}

fn project_extensions(conn: &Connection, id: i64) -> Result<ProjectExtensions> {
    let (own, picked): (bool, bool) = conn
        .query_row(
            "SELECT extensions_own, extensions_picked FROM projects WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(Error::NotFound("project"))?;
    let on = if picked {
        Some(
            conn.prepare(
                "SELECT extension FROM project_extensions WHERE project_id = ?1 ORDER BY extension",
            )?
            .query_map([id], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?,
        )
    } else {
        None
    };
    Ok(ProjectExtensions { own, on })
}

fn save_extensions(conn: &mut Connection, id: i64, chosen: &ProjectExtensions) -> Result<()> {
    let picks = chosen.on.as_deref().unwrap_or_default();
    if let Some(unknown) = picks.iter().find(|e| !extensions::is_known(e)) {
        return Err(Error::Invalid(format!(
            "Bomby has no extension called {unknown}."
        )));
    }
    let tx = conn.transaction()?;
    let changed = tx.execute(
        "UPDATE projects SET extensions_own = ?1, extensions_picked = ?2 WHERE id = ?3",
        params![chosen.own, chosen.on.is_some(), id],
    )?;
    if changed == 0 {
        return Err(Error::NotFound("project"));
    }
    tx.execute("DELETE FROM project_extensions WHERE project_id = ?1", [id])?;
    let mut insert = tx.prepare(
        "INSERT OR IGNORE INTO project_extensions (project_id, extension) VALUES (?1, ?2)",
    )?;
    for extension in picks {
        insert.execute(params![id, extension])?;
    }
    drop(insert);
    tx.commit()?;
    Ok(())
}

pub(crate) fn folders(conn: &Connection, id: i64) -> Result<Vec<String>> {
    Ok(conn
        .prepare("SELECT path FROM project_folders WHERE project_id = ?1 ORDER BY position")?
        .query_map([id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?)
}

fn load(conn: &Connection, id: i64) -> Result<Project> {
    let (name, instructions, created_at) = conn
        .query_row(
            "SELECT name, instructions, created_at FROM projects WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or(Error::NotFound("project"))?;

    let folders = folders(conn, id)?;
    let agents = agents(conn, id)?;
    let extensions = project_extensions(conn, id)?;

    let calls = conn
        .prepare(
            "SELECT id, started_at, ended_at FROM calls
             WHERE project_id = ?1 ORDER BY started_at DESC",
        )?
        .query_map([id], |row| {
            Ok(CallSummary {
                id: row.get(0)?,
                started_at: row.get(1)?,
                ended_at: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    Ok(Project {
        id,
        name,
        folders,
        instructions,
        agents,
        extensions,
        created_at,
        calls,
    })
}

fn list(conn: &Connection) -> Result<Vec<Project>> {
    let ids: Vec<i64> = conn
        .prepare("SELECT id FROM projects ORDER BY name COLLATE NOCASE")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    ids.into_iter().map(|id| load(conn, id)).collect()
}

fn create(conn: &mut Connection, input: ProjectInput) -> Result<Project> {
    let project = validate(input)?;
    let tx = conn.transaction()?;
    ensure_unique_name(&tx, &project.name, None)?;
    tx.execute(
        "INSERT INTO projects (name, instructions, created_at) VALUES (?1, ?2, ?3)",
        params![project.name, project.instructions, now_ms()],
    )?;
    let id = tx.last_insert_rowid();
    write_folders(&tx, id, &project.folders)?;
    tx.commit()?;
    load(conn, id)
}

fn update(conn: &mut Connection, id: i64, input: ProjectInput) -> Result<Project> {
    let project = validate(input)?;
    let tx = conn.transaction()?;
    ensure_unique_name(&tx, &project.name, Some(id))?;
    let changed = tx.execute(
        "UPDATE projects SET name = ?1, instructions = ?2 WHERE id = ?3",
        params![project.name, project.instructions, id],
    )?;
    if changed == 0 {
        return Err(Error::NotFound("project"));
    }
    write_folders(&tx, id, &project.folders)?;
    tx.commit()?;
    load(conn, id)
}

fn delete(conn: &Connection, id: i64) -> Result<()> {
    // Folders, calls and their messages go with it (ON DELETE CASCADE).
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}

#[tauri::command(async)]
pub fn list_projects(db: State<'_, Db>) -> Result<Vec<Project>> {
    list(&db.conn())
}

#[tauri::command(async)]
pub fn create_project(db: State<'_, Db>, input: ProjectInput) -> Result<Project> {
    create(&mut db.conn(), input)
}

#[tauri::command(async)]
pub fn update_project(db: State<'_, Db>, id: i64, input: ProjectInput) -> Result<Project> {
    update(&mut db.conn(), id, input)
}

/// Applies from the next call; one under way keeps its agents.
#[tauri::command(async)]
pub fn set_project_agents(db: State<'_, Db>, id: i64, agents: ProjectAgents) -> Result<Project> {
    let mut conn = db.conn();
    save_agents(&mut conn, id, &agents)?;
    load(&conn, id)
}

/// Applies from the next call; one under way keeps its extensions.
#[tauri::command(async)]
pub fn set_project_extensions(
    db: State<'_, Db>,
    id: i64,
    extensions: ProjectExtensions,
) -> Result<Project> {
    let mut conn = db.conn();
    save_extensions(&mut conn, id, &extensions)?;
    load(&conn, id)
}

#[tauri::command(async)]
pub fn delete_project(db: State<'_, Db>, id: i64) -> Result<()> {
    delete(&db.conn(), id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two folders that exist on any machine running the tests.
    fn folders() -> (String, String) {
        let root = env!("CARGO_MANIFEST_DIR");
        (root.to_owned(), format!("{root}/src"))
    }

    fn input(name: &str, folders: &[&str]) -> ProjectInput {
        ProjectInput {
            name: name.into(),
            folders: folders.iter().map(|f| (*f).to_owned()).collect(),
            instructions: String::new(),
        }
    }

    fn with_instructions(name: &str, folders: &[&str], instructions: &str) -> ProjectInput {
        ProjectInput {
            instructions: instructions.into(),
            ..input(name, folders)
        }
    }

    #[test]
    fn creates_lists_updates_and_deletes() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn();
        let (a, b) = folders();

        let samba = create(&mut conn, input(" samba ", &[&a, &b])).unwrap();
        assert_eq!(samba.name, "samba");
        assert_eq!(samba.folders, [a.clone(), b.clone()]);
        assert!(samba.calls.is_empty());
        create(&mut conn, input("Alpha", &[&a])).unwrap();

        let names: Vec<_> = list(&conn).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["Alpha", "samba"]);

        let renamed = update(&mut conn, samba.id, input("samba two", &[&b])).unwrap();
        assert_eq!(renamed.name, "samba two");
        assert_eq!(renamed.folders, [b]);

        delete(&conn, samba.id).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
        let folder_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM project_folders", [], |r| r.get(0))
            .unwrap();
        assert_eq!(folder_rows, 1, "the deleted project's folders went with it");
    }

    #[test]
    fn keeps_the_instructions_trimmed_and_lets_them_be_cleared() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn();
        let (a, _) = folders();

        let samba = create(&mut conn, input("samba", &[&a])).unwrap();
        assert_eq!(
            samba.instructions, "",
            "a project starts without instructions"
        );

        let text = "A music app.\n\nThe API is in Go.";
        let described = update(
            &mut conn,
            samba.id,
            with_instructions("samba", &[&a], &format!("  {text}\n ")),
        )
        .unwrap();
        assert_eq!(described.instructions, text);
        assert_eq!(for_call(&conn, samba.id).unwrap().instructions, text);

        let cleared = update(&mut conn, samba.id, with_instructions("samba", &[&a], "  ")).unwrap();
        assert_eq!(cleared.instructions, "");

        let at_limit = "x".repeat(MAX_INSTRUCTIONS_LEN);
        let full = create(&mut conn, with_instructions("full", &[&a], &at_limit)).unwrap();
        assert_eq!(full.instructions, at_limit);
    }

    #[test]
    fn names_are_unique_ignoring_case() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn();
        let (a, _) = folders();
        let first = create(&mut conn, input("Samba", &[&a])).unwrap();
        assert!(matches!(
            create(&mut conn, input("samba", &[&a])),
            Err(Error::Invalid(_))
        ));
        // Keeping its own name on update is fine.
        update(&mut conn, first.id, input("SAMBA", &[&a])).unwrap();
    }

    #[test]
    fn rejects_bad_input() {
        let (a, _) = folders();
        for bad in [
            input("  ", &[&a]),
            input("samba", &["relative/path"]),
            input("samba", &["/no/such/folder/anywhere"]),
            input("samba", &[&a, &a]),
            input(&"x".repeat(MAX_NAME_LEN + 1), &[&a]),
            with_instructions("samba", &[&a], &"x".repeat(MAX_INSTRUCTIONS_LEN + 1)),
        ] {
            assert!(matches!(validate(bad), Err(Error::Invalid(_))));
        }
    }

    #[test]
    fn a_project_hands_work_to_every_agent_until_told_otherwise() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn();
        let (a, _) = folders();
        let id = create(&mut conn, input("samba", &[&a])).unwrap().id;
        let agents = |conn: &Connection| for_call(conn, id).unwrap().agents;
        assert_eq!(agents(&conn), ProjectAgents::default());
        assert!(agents(&conn).allows("goose"));

        let only = ProjectAgents {
            on: true,
            only: vec!["codex".into(), "claude".into(), "claude".into()],
        };
        save_agents(&mut conn, id, &only).unwrap();
        let saved = agents(&conn);
        assert_eq!(saved.only, ["claude", "codex"]);
        assert!(saved.allows("claude") && !saved.allows("goose"));

        // Off keeps the picks for when it's on again.
        let off = ProjectAgents { on: false, ..saved };
        save_agents(&mut conn, id, &off).unwrap();
        assert_eq!(agents(&conn), off);
        assert!(!agents(&conn).allows("claude"));

        let unknown = ProjectAgents {
            on: true,
            only: vec!["hal".into()],
        };
        assert!(matches!(
            save_agents(&mut conn, id, &unknown),
            Err(Error::Invalid(_))
        ));
        assert!(matches!(
            save_agents(&mut conn, id + 1, &off),
            Err(Error::NotFound(_))
        ));
    }

    #[test]
    fn a_project_follows_settings_for_extensions_until_it_picks_its_own() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn();
        let (a, _) = folders();
        let id = create(&mut conn, input("samba", &[&a])).unwrap().id;
        let chosen = |conn: &Connection| for_call(conn, id).unwrap().extensions;
        assert_eq!(chosen(&conn), ProjectExtensions::default());

        let none = ProjectExtensions {
            own: true,
            on: Some(Vec::new()),
        };
        save_extensions(&mut conn, id, &none).unwrap();
        assert_eq!(chosen(&conn), none, "a pick of none is kept as none");

        let todos = ProjectExtensions {
            own: false,
            on: Some(vec!["todos".into()]),
        };
        save_extensions(&mut conn, id, &todos).unwrap();
        assert_eq!(
            chosen(&conn),
            todos,
            "its picks are kept while it follows Settings"
        );

        let unknown = ProjectExtensions {
            own: true,
            on: Some(vec!["hal".into()]),
        };
        assert!(matches!(
            save_extensions(&mut conn, id, &unknown),
            Err(Error::Invalid(_))
        ));
        assert!(matches!(
            save_extensions(&mut conn, id + 1, &todos),
            Err(Error::NotFound(_))
        ));
    }

    #[test]
    fn a_project_needs_only_a_name() {
        // Without folders, its agents work in the home folder (`agent/project.py`).
        let valid = validate(input("samba", &[])).unwrap();
        assert!(valid.folders.is_empty());
    }

    #[test]
    fn updating_a_missing_project_is_not_found() {
        let db = Db::in_memory().unwrap();
        let (a, _) = folders();
        assert!(matches!(
            update(&mut db.conn(), 42, input("samba", &[&a])),
            Err(Error::NotFound(_))
        ));
    }
}
