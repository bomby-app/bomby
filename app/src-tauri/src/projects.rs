//! Projects: a name and the folders Claude may work in (the first is its working directory),
//! each with its calls. The sidebar tree is `list_projects`.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{Db, now_ms};
use crate::error::{Error, Result};

const MAX_NAME_LEN: usize = 80;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    id: i64,
    name: String,
    folders: Vec<String>,
    created_at: i64,
    /// Newest first.
    calls: Vec<CallSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallSummary {
    id: i64,
    started_at: i64,
    ended_at: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    name: String,
    folders: Vec<String>,
}

/// Trims and checks what the page sent. The folder rules match the agent's
/// (`agent/project.py`, `Project.from_job`): absolute paths to existing folders.
fn validate(input: ProjectInput) -> Result<(String, Vec<String>)> {
    let name = input.name.trim().to_owned();
    if name.is_empty() {
        return Err(Error::Invalid("Give the project a name.".into()));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(Error::Invalid(format!(
            "Keep the name under {MAX_NAME_LEN} characters."
        )));
    }

    if input.folders.is_empty() {
        return Err(Error::Invalid("Add at least one folder.".into()));
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
    Ok((name, folders))
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

/// What a call needs of a project: what it's called and where it lives.
pub(crate) struct CallProject {
    pub(crate) name: String,
    pub(crate) folders: Vec<String>,
}

/// The project's name and folders, without its calls.
pub(crate) fn for_call(conn: &Connection, id: i64) -> Result<CallProject> {
    let name = conn
        .query_row("SELECT name FROM projects WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()?
        .ok_or(Error::NotFound("project"))?;
    Ok(CallProject {
        name,
        folders: folders(conn, id)?,
    })
}

fn folders(conn: &Connection, id: i64) -> Result<Vec<String>> {
    Ok(conn
        .prepare("SELECT path FROM project_folders WHERE project_id = ?1 ORDER BY position")?
        .query_map([id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?)
}

fn load(conn: &Connection, id: i64) -> Result<Project> {
    let (name, created_at) = conn
        .query_row(
            "SELECT name, created_at FROM projects WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(Error::NotFound("project"))?;

    let folders = folders(conn, id)?;

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
    let (name, folders) = validate(input)?;
    let tx = conn.transaction()?;
    ensure_unique_name(&tx, &name, None)?;
    tx.execute(
        "INSERT INTO projects (name, created_at) VALUES (?1, ?2)",
        params![name, now_ms()],
    )?;
    let id = tx.last_insert_rowid();
    write_folders(&tx, id, &folders)?;
    tx.commit()?;
    load(conn, id)
}

fn update(conn: &mut Connection, id: i64, input: ProjectInput) -> Result<Project> {
    let (name, folders) = validate(input)?;
    let tx = conn.transaction()?;
    ensure_unique_name(&tx, &name, Some(id))?;
    let changed = tx.execute(
        "UPDATE projects SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;
    if changed == 0 {
        return Err(Error::NotFound("project"));
    }
    write_folders(&tx, id, &folders)?;
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
            input("samba", &[]),
            input("samba", &["relative/path"]),
            input("samba", &["/no/such/folder/anywhere"]),
            input("samba", &[&a, &a]),
            input(&"x".repeat(MAX_NAME_LEN + 1), &[&a]),
        ] {
            assert!(matches!(validate(bad), Err(Error::Invalid(_))));
        }
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
