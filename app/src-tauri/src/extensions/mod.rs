//! Extensions (docs/decisions/extensions.md): tool sets the voice agent gets on a call,
//! defined in `agent/extensions/`, whose catalogue (`extensions.json`) the core embeds. The
//! user turns each on or off in Settings, Extensions (`extensions_settings`,
//! `set_extension`), and a project follows that or picks its own
//! (`projects::set_project_extensions`). A call opens with the ones it has, and its job's
//! metadata carries what each needs at the start (`for_call`). Each extension keeps its
//! data here: `todos.rs`.

pub mod todos;

use std::sync::LazyLock;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::db::Db;
use crate::error::{Error, Result};
use crate::settings;

/// Sent to every window when an extension is turned on or off in Settings.
pub const CHANGED: &str = "extensions-changed";

const CATALOGUE_JSON: &str = include_str!("../../extensions.json");

static CATALOGUE: LazyLock<Catalogue> = LazyLock::new(|| {
    serde_json::from_str(CATALOGUE_JSON).expect("extensions.json is the agent's catalogue")
});

#[derive(Deserialize)]
struct Catalogue {
    extensions: Vec<CatalogueEntry>,
}

/// One extension in the catalogue (`catalogue.py` in `agent/extensions/`).
#[derive(Deserialize)]
struct CatalogueEntry {
    id: String,
    name: String,
    description: String,
    default_on: bool,
}

/// An extension as Settings, Extensions shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "extensions.ts"))]
pub struct ExtensionSetting {
    id: String,
    name: String,
    description: String,
    /// On for every project that follows Settings.
    on: bool,
}

/// Which extensions a project's calls have (Project settings, Extensions). Saved as it
/// changes (`projects::set_project_extensions`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "projects.ts"))]
pub struct ProjectExtensions {
    /// Picks its own rather than following Settings.
    pub own: bool,
    /// With `own`, the ones on, by id; kept while it follows Settings, for when it picks
    /// again.
    pub on: Vec<String>,
}

/// Whether Bomby has an extension called `id`.
pub fn is_known(id: &str) -> bool {
    CATALOGUE.extensions.iter().any(|e| e.id == id)
}

fn setting_key(id: &str) -> String {
    format!("extension.{id}")
}

/// Each extension with whether Settings has it on: as the user set it, else its default.
fn settings(conn: &Connection) -> Result<Vec<ExtensionSetting>> {
    CATALOGUE
        .extensions
        .iter()
        .map(|e| {
            let on = match settings::get(conn, &setting_key(&e.id))?.as_deref() {
                Some("on") => true,
                Some("off") => false,
                _ => e.default_on,
            };
            Ok(ExtensionSetting {
                id: e.id.clone(),
                name: e.name.clone(),
                description: e.description.clone(),
                on,
            })
        })
        .collect()
}

fn save(conn: &Connection, id: &str, on: bool) -> Result<()> {
    if !is_known(id) {
        return Err(Error::Invalid(format!(
            "Bomby has no extension called {id}."
        )));
    }
    settings::put(conn, &setting_key(id), if on { "on" } else { "off" })
}

/// The extensions a project's calls have, by id, in the catalogue's order.
pub(crate) fn on_for(conn: &Connection, project: &ProjectExtensions) -> Result<Vec<String>> {
    Ok(settings(conn)?
        .into_iter()
        .filter(|e| {
            if project.own {
                project.on.contains(&e.id)
            } else {
                e.on
            }
        })
        .map(|e| e.id)
        .collect())
}

/// The job's `extensions` for a call on `project_id` that has `on`: each one's id with what
/// it needs at the start (`extensions` in `agent/job.py`).
pub(crate) fn for_call(
    conn: &Connection,
    project_id: i64,
    on: &[String],
) -> Result<serde_json::Map<String, serde_json::Value>> {
    on.iter()
        .map(|id| {
            let data = match id.as_str() {
                todos::ID => todos::for_call(conn, project_id)?,
                _ => serde_json::json!({}),
            };
            Ok((id.clone(), data))
        })
        .collect()
}

#[tauri::command(async)]
pub fn extensions_settings(db: State<'_, Db>) -> Result<Vec<ExtensionSetting>> {
    settings(&db.conn())
}

/// Applies from the next call; one under way keeps its extensions.
#[tauri::command(async)]
pub fn set_extension<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    id: String,
    on: bool,
) -> Result<Vec<ExtensionSetting>> {
    let conn = db.conn();
    save(&conn, &id, on)?;
    let now = settings(&conn)?;
    let _ = app.emit(CHANGED, ());
    Ok(now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalogue_has_the_todos() {
        assert!(is_known(todos::ID));
        assert!(!is_known("hal"));
    }

    #[test]
    fn settings_start_at_each_default_and_keep_what_the_user_set() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let on = |conn: &Connection| settings(conn).unwrap()[0].on;
        assert!(on(&conn), "to-dos are on by default");

        save(&conn, todos::ID, false).unwrap();
        assert!(!on(&conn));
        assert!(matches!(save(&conn, "hal", true), Err(Error::Invalid(_))));
    }

    #[test]
    fn a_project_follows_settings_until_it_picks_its_own() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let follows = ProjectExtensions::default();
        assert_eq!(on_for(&conn, &follows).unwrap(), [todos::ID]);

        let none_of_its_own = ProjectExtensions {
            own: true,
            on: Vec::new(),
        };
        assert!(on_for(&conn, &none_of_its_own).unwrap().is_empty());

        save(&conn, todos::ID, false).unwrap();
        assert!(on_for(&conn, &follows).unwrap().is_empty());
        let its_own = ProjectExtensions {
            own: true,
            on: vec![todos::ID.into(), "from-a-newer-app".into()],
        };
        assert_eq!(on_for(&conn, &its_own).unwrap(), [todos::ID]);
    }
}
