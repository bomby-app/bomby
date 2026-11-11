//! To-dos: a list for each project that the user and Bomby keep together
//! (docs/decisions/extensions.md). The page reads and changes it with these commands, for
//! the user in the to-do panel and for Bomby when the voice agent asks over RPC
//! (`features/todos/`); every change tells every window (`CHANGED`). Each to-do has a
//! number of its own in the project, never reused, so it can be named by voice.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::db::{Db, now_ms};
use crate::error::{Error, Result};

/// Its id in the catalogue (`agent/extensions/todos.py`).
pub const ID: &str = "todos";
/// Sent to every window when a project's to-dos change, with the project's id.
pub const CHANGED: &str = "todos-changed";

/// About a line in the panel, and quick for Bomby to say. The page holds the same limits
/// (`features/todos/limits.ts`).
const MAX_TITLE_LEN: usize = 120;
/// A few short paragraphs.
const MAX_NOTES_LEN: usize = 1000;
/// The most added at once; the agent's `add_todos` holds the same limit.
const MAX_ADD: usize = 20;
/// The most open to-dos a call starts knowing, the newest first; it can list the rest.
/// About 30 short lines, well under LiveKit's limits.
const CALL_OPEN: i64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "todos.ts"))]
pub enum TodoStatus {
    Todo,
    Doing,
    Done,
    Cancelled,
}

impl TodoStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::Doing => "doing",
            Self::Done => "done",
            Self::Cancelled => "cancelled",
        }
    }

    fn parse(text: &str) -> Self {
        match text {
            "doing" => Self::Doing,
            "done" => Self::Done,
            "cancelled" => Self::Cancelled,
            _ => Self::Todo,
        }
    }
}

/// Who made a change: the user in the app, or Bomby on a call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "todos.ts"))]
pub enum Author {
    User,
    Bomby,
}

impl Author {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Bomby => "bomby",
        }
    }

    fn parse(text: &str) -> Self {
        if text == "bomby" {
            Self::Bomby
        } else {
            Self::User
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "todos.ts"))]
pub struct Todo {
    /// Its own in the project, from 1, never reused.
    number: i64,
    title: String,
    /// Empty when there are none.
    notes: String,
    status: TodoStatus,
    created_by: Author,
    /// Who changed it last, or made it.
    updated_by: Author,
    created_at: i64,
    updated_at: i64,
    /// When it was last marked done, while it is.
    done_at: Option<i64>,
}

/// A to-do to add.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "todos.ts"))]
pub struct NewTodo {
    title: String,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    notes: Option<String>,
}

/// What changes in a to-do; what's left out stays.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "todos.ts"))]
pub struct TodoChange {
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    title: Option<String>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    notes: Option<String>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    status: Option<TodoStatus>,
}

/// What a project's to-dos tell the voice agent when a call starts (`TodosData` in
/// `agent/extensions/todos.py`).
#[derive(Debug, Serialize)]
struct CallTodos {
    open: Vec<CallTodo>,
    more: i64,
}

#[derive(Debug, Serialize)]
struct CallTodo {
    number: i64,
    title: String,
    status: TodoStatus,
}

const COLUMNS: &str =
    "number, title, notes, status, created_by, updated_by, created_at, updated_at, done_at";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Todo> {
    Ok(Todo {
        number: row.get(0)?,
        title: row.get(1)?,
        notes: row.get(2)?,
        status: TodoStatus::parse(&row.get::<_, String>(3)?),
        created_by: Author::parse(&row.get::<_, String>(4)?),
        updated_by: Author::parse(&row.get::<_, String>(5)?),
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        done_at: row.get(8)?,
    })
}

fn title(text: &str) -> Result<String> {
    let title = text.trim();
    if title.is_empty() {
        return Err(Error::Invalid("A to-do needs a few words.".into()));
    }
    if title.chars().count() > MAX_TITLE_LEN {
        return Err(Error::Invalid(format!(
            "Keep a to-do under {MAX_TITLE_LEN} characters."
        )));
    }
    Ok(title.to_owned())
}

fn notes(text: &str) -> Result<String> {
    let notes = text.trim();
    if notes.chars().count() > MAX_NOTES_LEN {
        return Err(Error::Invalid(format!(
            "Keep a to-do's notes under {MAX_NOTES_LEN} characters."
        )));
    }
    Ok(notes.to_owned())
}

fn missing(number: i64) -> Error {
    Error::Invalid(format!("There's no to-do number {number}."))
}

/// A project's to-dos in the order they were added.
fn list(conn: &Connection, project_id: i64) -> Result<Vec<Todo>> {
    Ok(conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM todos WHERE project_id = ?1 ORDER BY number"
        ))?
        .query_map([project_id], from_row)?
        .collect::<rusqlite::Result<_>>()?)
}

fn get(conn: &Connection, project_id: i64, number: i64) -> Result<Todo> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM todos WHERE project_id = ?1 AND number = ?2"),
        params![project_id, number],
        from_row,
    )
    .optional()?
    .ok_or_else(|| missing(number))
}

fn add(
    conn: &mut Connection,
    project_id: i64,
    items: Vec<NewTodo>,
    by: Author,
) -> Result<Vec<Todo>> {
    if items.is_empty() {
        return Err(Error::Invalid("There was nothing to add.".into()));
    }
    if items.len() > MAX_ADD {
        return Err(Error::Invalid(format!(
            "Add at most {MAX_ADD} to-dos at once."
        )));
    }
    let valid = items
        .iter()
        .map(|item| {
            Ok((
                title(&item.title)?,
                notes(item.notes.as_deref().unwrap_or(""))?,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    let count = i64::try_from(valid.len()).unwrap_or(i64::MAX);
    let tx = conn.transaction()?;
    // Numbers come from the project's own count, so a deleted one is never reused.
    let last: i64 = tx
        .query_row(
            "UPDATE projects SET todos_made = todos_made + ?1 WHERE id = ?2 RETURNING todos_made",
            params![count, project_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(Error::NotFound("project"))?;
    let now = now_ms();
    let mut insert = tx.prepare(
        "INSERT INTO todos (project_id, number, title, notes, status, created_by, updated_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'todo', ?5, ?5, ?6, ?6)",
    )?;
    let first = last - count + 1;
    for ((title, notes), number) in valid.iter().zip(first..) {
        insert.execute(params![project_id, number, title, notes, by.as_str(), now])?;
    }
    drop(insert);
    tx.commit()?;
    (first..=last).map(|n| get(conn, project_id, n)).collect()
}

fn update(
    conn: &Connection,
    project_id: i64,
    number: i64,
    change: TodoChange,
    by: Author,
) -> Result<Todo> {
    let was = get(conn, project_id, number)?;
    let title = change.title.as_deref().map(title).transpose()?;
    let notes = change.notes.as_deref().map(notes).transpose()?;
    let status = change.status.unwrap_or(was.status);
    let now = now_ms();
    // Done keeps the moment it was ticked off; anything else has no done time.
    let done_at = match (status, was.done_at) {
        (TodoStatus::Done, Some(at)) => Some(at),
        (TodoStatus::Done, None) => Some(now),
        _ => None,
    };
    conn.execute(
        "UPDATE todos SET title = ?1, notes = ?2, status = ?3, done_at = ?4, updated_by = ?5,
         updated_at = ?6 WHERE project_id = ?7 AND number = ?8",
        params![
            title.unwrap_or(was.title),
            notes.unwrap_or(was.notes),
            status.as_str(),
            done_at,
            by.as_str(),
            now,
            project_id,
            number
        ],
    )?;
    get(conn, project_id, number)
}

fn remove(conn: &Connection, project_id: i64, number: i64) -> Result<Todo> {
    let todo = get(conn, project_id, number)?;
    conn.execute(
        "DELETE FROM todos WHERE project_id = ?1 AND number = ?2",
        params![project_id, number],
    )?;
    Ok(todo)
}

/// The job's `todos`: the open ones, the newest first, and how many more there are.
pub(crate) fn for_call(conn: &Connection, project_id: i64) -> Result<serde_json::Value> {
    let open: Vec<CallTodo> = conn
        .prepare(
            "SELECT number, title, status FROM todos
             WHERE project_id = ?1 AND status IN ('todo', 'doing')
             ORDER BY number DESC LIMIT ?2",
        )?
        .query_map(params![project_id, CALL_OPEN], |row| {
            Ok(CallTodo {
                number: row.get(0)?,
                title: row.get(1)?,
                status: TodoStatus::parse(&row.get::<_, String>(2)?),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM todos WHERE project_id = ?1 AND status IN ('todo', 'doing')",
        [project_id],
        |row| row.get(0),
    )?;
    let more = total - i64::try_from(open.len()).unwrap_or(0);
    Ok(serde_json::to_value(CallTodos { open, more }).unwrap_or_default())
}

/// The project whose to-dos changed, for the windows that show them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "todos.ts"))]
pub struct TodosChanged {
    project_id: i64,
}

fn changed<R: Runtime>(app: &AppHandle<R>, project_id: i64) {
    let _ = app.emit(CHANGED, TodosChanged { project_id });
}

#[tauri::command(async)]
pub fn list_todos(db: State<'_, Db>, project_id: i64) -> Result<Vec<Todo>> {
    list(&*db.conn()?, project_id)
}

#[tauri::command(async)]
pub fn add_todos<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    project_id: i64,
    items: Vec<NewTodo>,
    by: Author,
) -> Result<Vec<Todo>> {
    let added = add(&mut *db.conn()?, project_id, items, by)?;
    changed(&app, project_id);
    Ok(added)
}

#[tauri::command(async)]
pub fn update_todo<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    project_id: i64,
    number: i64,
    change: TodoChange,
    by: Author,
) -> Result<Todo> {
    let todo = update(&*db.conn()?, project_id, number, change, by)?;
    changed(&app, project_id);
    Ok(todo)
}

#[tauri::command(async)]
pub fn remove_todo<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    project_id: i64,
    number: i64,
) -> Result<Todo> {
    let todo = remove(&*db.conn()?, project_id, number)?;
    changed(&app, project_id);
    Ok(todo)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(conn: &Connection, name: &str) -> i64 {
        conn.execute(
            "INSERT INTO projects (name, created_at) VALUES (?1, 0)",
            [name],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn new(title: &str) -> NewTodo {
        NewTodo {
            title: title.into(),
            notes: None,
        }
    }

    fn status(status: TodoStatus) -> TodoChange {
        TodoChange {
            status: Some(status),
            ..TodoChange::default()
        }
    }

    #[test]
    fn adds_numbers_and_lists_each_projects_own() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let samba = project(&conn, "samba");
        let other = project(&conn, "other");

        let added = add(
            &mut conn,
            samba,
            vec![new(" Fix the reminders "), new("Rewrite the copy")],
            Author::Bomby,
        )
        .unwrap();
        assert_eq!(added.iter().map(|t| t.number).collect::<Vec<_>>(), [1, 2]);
        assert_eq!(added[0].title, "Fix the reminders");
        assert_eq!(added[0].status, TodoStatus::Todo);
        assert_eq!(added[0].created_by, Author::Bomby);

        add(&mut conn, other, vec![new("Elsewhere")], Author::User).unwrap();
        assert_eq!(list(&conn, samba).unwrap().len(), 2);
        assert_eq!(
            list(&conn, other).unwrap()[0].number,
            1,
            "each project counts its own"
        );
    }

    #[test]
    fn a_removed_number_is_never_reused() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let samba = project(&conn, "samba");
        add(&mut conn, samba, vec![new("One"), new("Two")], Author::User).unwrap();

        let removed = remove(&conn, samba, 2).unwrap();
        assert_eq!(removed.title, "Two");
        let next = add(&mut conn, samba, vec![new("Three")], Author::User).unwrap();
        assert_eq!(next[0].number, 3);
        assert!(
            matches!(remove(&conn, samba, 2), Err(Error::Invalid(m)) if m == "There's no to-do number 2.")
        );
    }

    #[test]
    fn an_update_changes_only_what_it_names_and_records_who() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let samba = project(&conn, "samba");
        add(
            &mut conn,
            samba,
            vec![new("Fix the reminders")],
            Author::User,
        )
        .unwrap();

        let noted = update(
            &conn,
            samba,
            1,
            TodoChange {
                notes: Some(" Only on iOS ".into()),
                ..TodoChange::default()
            },
            Author::Bomby,
        )
        .unwrap();
        assert_eq!(noted.title, "Fix the reminders");
        assert_eq!(noted.notes, "Only on iOS");
        assert_eq!(noted.created_by, Author::User);
        assert_eq!(noted.updated_by, Author::Bomby);

        let done = update(&conn, samba, 1, status(TodoStatus::Done), Author::User).unwrap();
        let at = done.done_at.expect("done has a time");
        let again = update(&conn, samba, 1, status(TodoStatus::Done), Author::User).unwrap();
        assert_eq!(
            again.done_at,
            Some(at),
            "done again keeps when it was ticked off"
        );
        let reopened = update(&conn, samba, 1, status(TodoStatus::Doing), Author::User).unwrap();
        assert_eq!(reopened.done_at, None);
    }

    #[test]
    fn rejects_what_wont_fit_or_isnt_there() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let samba = project(&conn, "samba");
        let long = "x".repeat(MAX_TITLE_LEN + 1);
        for bad in [
            vec![],
            vec![new("  ")],
            vec![new(&long)],
            (0..=MAX_ADD).map(|_| new("x")).collect(),
        ] {
            assert!(matches!(
                add(&mut conn, samba, bad, Author::User),
                Err(Error::Invalid(_))
            ));
        }
        let long_notes = NewTodo {
            title: "x".into(),
            notes: Some("x".repeat(MAX_NOTES_LEN + 1)),
        };
        assert!(matches!(
            add(&mut conn, samba, vec![long_notes], Author::User),
            Err(Error::Invalid(_))
        ));
        assert!(
            list(&conn, samba).unwrap().is_empty(),
            "a refused batch adds nothing"
        );
        let just_fits = NewTodo {
            title: "x".repeat(MAX_TITLE_LEN),
            notes: Some("é".repeat(MAX_NOTES_LEN)),
        };
        add(&mut conn, samba, vec![just_fits], Author::User)
            .expect("the limits count characters, not bytes");
        assert!(matches!(
            add(&mut conn, samba + 1, vec![new("x")], Author::User),
            Err(Error::NotFound(_))
        ));
        assert!(matches!(
            update(&conn, samba, 9, status(TodoStatus::Done), Author::User),
            Err(Error::Invalid(_))
        ));
    }

    #[test]
    fn a_call_starts_knowing_the_newest_open_ones() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let samba = project(&conn, "samba");
        let items = (1..=CALL_OPEN + 3)
            .map(|i| new(&format!("To-do {i}")))
            .collect::<Vec<_>>();
        for chunk in items.chunks(MAX_ADD) {
            let chunk = chunk.iter().map(|t| new(&t.title)).collect();
            add(&mut conn, samba, chunk, Author::User).unwrap();
        }
        update(
            &conn,
            samba,
            CALL_OPEN + 3,
            status(TodoStatus::Done),
            Author::User,
        )
        .unwrap();

        let call = for_call(&conn, samba).unwrap();
        let open = call["open"].as_array().unwrap();
        assert_eq!(open.len(), usize::try_from(CALL_OPEN).unwrap());
        assert_eq!(
            open[0]["number"],
            CALL_OPEN + 2,
            "the newest open one first"
        );
        assert_eq!(open[0]["status"], "todo");
        assert_eq!(call["more"], 2);
    }

    #[test]
    fn todos_go_with_their_project() {
        let db = Db::in_memory().unwrap();
        let mut conn = db.conn().unwrap();
        let samba = project(&conn, "samba");
        add(&mut conn, samba, vec![new("One")], Author::User).unwrap();
        conn.execute("DELETE FROM projects WHERE id = ?1", [samba])
            .unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM todos", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }
}
