//! Extensions (docs/decisions/extensions.md): tool sets the voice agent gets on a call,
//! defined in `agent/extensions/`, whose catalogue (`extensions.json`) the core embeds. The
//! user turns each on or off in Settings, Extensions (`extensions_settings`,
//! `set_extension`), and a project follows that or picks its own
//! (`projects::set_project_extensions`). A call opens with the ones it has, and its job's
//! metadata carries what each needs at the start (`for_call`). Each extension keeps its
//! data here: `todos.rs`; call names are the call's own (`calls.rs`), and `call_names.rs`
//! only hands Bomby the name a call starts with. The hosted MCP ones (Zapier, Composio) sign in instead
//! (docs/decisions/hosted-mcp-extensions-with-oauth.md): `oauth.rs` is the flow,
//! `connections.rs` keeps the grants, and `tokens.rs` hands the worker their tokens; a call
//! has one only once it's connected.

pub mod call_names;
pub mod connections;
pub mod oauth;
pub mod todos;
pub mod tokens;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

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
    connect: Option<ConnectSpec>,
}

/// How a hosted MCP extension connects (`Connect` in `agent/extensions/hosted_mcp.py`).
#[derive(Debug, Deserialize)]
pub struct ConnectSpec {
    /// The vendor's MCP server.
    pub mcp_url: String,
    /// Where the user manages what Bomby can reach on the vendor's side.
    pub manage_url: String,
    /// The hosts its sign-in links may open, each with its subdomains.
    pub link_hosts: Vec<String>,
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
    /// For one that signs in (Zapier, Composio): whether it's connected. None for the rest.
    connection: Option<Connection>,
}

/// A hosted MCP extension's sign-in, as Settings shows it. No token ever comes with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "extensions.ts"))]
pub struct Connection {
    connected: bool,
    /// A sign-in is under way in the browser (`connect_extension`).
    connecting: bool,
    /// The account it's signed in as, when the vendor said.
    account: Option<String>,
    /// Where the user manages what Bomby can reach on the vendor's side.
    manage_url: String,
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
    /// again. None until it first picks, so picking starts from Settings' only then.
    pub on: Option<Vec<String>>,
}

/// Whether Bomby has an extension called `id`.
pub fn is_known(id: &str) -> bool {
    CATALOGUE.extensions.iter().any(|e| e.id == id)
}

/// The extension's name in Settings ("Zapier").
pub fn name(id: &str) -> Option<&'static str> {
    CATALOGUE
        .extensions
        .iter()
        .find(|e| e.id == id)
        .map(|e| e.name.as_str())
}

/// How the extension connects, for one that signs in.
pub fn connect_spec(id: &str) -> Option<&'static ConnectSpec> {
    CATALOGUE
        .extensions
        .iter()
        .find(|e| e.id == id)
        .and_then(|e| e.connect.as_ref())
}

fn setting_key(id: &str) -> String {
    format!("extension.{id}")
}

/// Which hosted MCP extensions are signed in, as which account, and which are signing in
/// now (`connections::sign_ins`).
#[derive(Default)]
pub(crate) struct SignIns {
    pub accounts: BTreeMap<String, Option<String>>,
    pub connecting: BTreeSet<String>,
}

/// Each extension with whether Settings has it on (as the user set it, else its default),
/// and for one that signs in, its sign-in.
fn settings(conn: &rusqlite::Connection, sign_ins: &SignIns) -> Result<Vec<ExtensionSetting>> {
    CATALOGUE
        .extensions
        .iter()
        .map(|e| {
            let on = match settings::get(conn, &setting_key(&e.id))?.as_deref() {
                Some("on") => true,
                Some("off") => false,
                _ => e.default_on,
            };
            let connection = e.connect.as_ref().map(|spec| {
                let account = sign_ins.accounts.get(&e.id);
                Connection {
                    connected: account.is_some(),
                    connecting: sign_ins.connecting.contains(&e.id),
                    account: account.cloned().flatten(),
                    manage_url: spec.manage_url.clone(),
                }
            });
            Ok(ExtensionSetting {
                id: e.id.clone(),
                name: e.name.clone(),
                description: e.description.clone(),
                on,
                connection,
            })
        })
        .collect()
}

fn save(conn: &rusqlite::Connection, id: &str, on: bool) -> Result<()> {
    if !is_known(id) {
        return Err(Error::Invalid(format!(
            "Bomby has no extension called {id}."
        )));
    }
    settings::put(conn, &setting_key(id), if on { "on" } else { "off" })
}

/// The extensions a project's calls have, by id, in the catalogue's order: those on for it,
/// less any that signs in and isn't `connected`, whose tools couldn't work.
pub(crate) fn on_for(
    conn: &rusqlite::Connection,
    project: &ProjectExtensions,
    connected: &BTreeSet<String>,
) -> Result<Vec<String>> {
    Ok(settings(conn, &SignIns::default())?
        .into_iter()
        .filter(|e| {
            if project.own {
                project.on.as_ref().is_some_and(|on| on.contains(&e.id))
            } else {
                e.on
            }
        })
        .filter(|e| e.connection.is_none() || connected.contains(&e.id))
        .map(|e| e.id)
        .collect())
}

/// The job's `extensions` for call `call_id` on `project_id` that has `on`: each one's id
/// with what it needs at the start (`extensions` in `agent/job.py`).
pub(crate) fn for_call(
    conn: &rusqlite::Connection,
    project_id: i64,
    call_id: i64,
    on: &[String],
) -> Result<serde_json::Map<String, serde_json::Value>> {
    on.iter()
        .map(|id| {
            let data = match id.as_str() {
                todos::ID => todos::for_call(conn, project_id)?,
                call_names::ID => call_names::for_call(conn, call_id)?,
                _ => serde_json::json!({}),
            };
            Ok((id.clone(), data))
        })
        .collect()
}

#[tauri::command(async)]
pub fn extensions_settings<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
) -> Result<Vec<ExtensionSetting>> {
    settings(&db.conn(), &connections::sign_ins(&app)?)
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
    let now = settings(&conn, &connections::sign_ins(&app)?)?;
    let _ = app.emit(CHANGED, ());
    Ok(now)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none() -> BTreeSet<String> {
        BTreeSet::new()
    }

    #[test]
    fn the_catalogue_has_the_todos_and_the_hosted_mcp_ones() {
        assert!(is_known(todos::ID) && is_known(call_names::ID));
        assert!(!is_known("hal"));
        assert!(connect_spec(todos::ID).is_none());
        let zapier = connect_spec("zapier").unwrap();
        assert_eq!(zapier.mcp_url, "https://mcp.zapier.com/api/v1/connect");
        assert_eq!(zapier.link_hosts, ["zapier.com"]);
        assert!(connect_spec("composio").is_some());
        assert_eq!(name("composio"), Some("Composio"));
    }

    #[test]
    fn settings_start_at_each_default_and_keep_what_the_user_set() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let on = |conn: &rusqlite::Connection, id: &str| {
            settings(conn, &SignIns::default())
                .unwrap()
                .into_iter()
                .find(|e| e.id == id)
                .unwrap()
                .on
        };
        assert!(on(&conn, todos::ID), "to-dos are on by default");
        assert!(
            !on(&conn, "zapier"),
            "the hosted ones are off until the user wants them"
        );

        save(&conn, todos::ID, false).unwrap();
        assert!(!on(&conn, todos::ID));
        assert!(matches!(save(&conn, "hal", true), Err(Error::Invalid(_))));
    }

    #[test]
    fn settings_say_who_a_hosted_one_is_connected_as_and_which_is_connecting() {
        let db = Db::in_memory().unwrap();
        let sign_ins = SignIns {
            accounts: BTreeMap::from([("zapier".to_owned(), Some("me@example.com".to_owned()))]),
            connecting: BTreeSet::from(["composio".to_owned()]),
        };
        let all = settings(&db.conn(), &sign_ins).unwrap();
        let find = |id: &str| all.iter().find(|e| e.id == id).unwrap().clone();
        assert_eq!(find(todos::ID).connection, None);
        assert_eq!(
            find("zapier").connection,
            Some(Connection {
                connected: true,
                connecting: false,
                account: Some("me@example.com".into()),
                manage_url: "https://mcp.zapier.com".into(),
            })
        );
        let composio = find("composio").connection.unwrap();
        assert!(!composio.connected && composio.connecting);
    }

    #[test]
    fn a_project_follows_settings_until_it_picks_its_own() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let follows = ProjectExtensions::default();
        assert_eq!(
            on_for(&conn, &follows, &none()).unwrap(),
            [todos::ID, call_names::ID]
        );

        let none_of_its_own = ProjectExtensions {
            own: true,
            on: Some(Vec::new()),
        };
        assert!(on_for(&conn, &none_of_its_own, &none()).unwrap().is_empty());

        save(&conn, todos::ID, false).unwrap();
        assert_eq!(on_for(&conn, &follows, &none()).unwrap(), [call_names::ID]);
        let its_own = ProjectExtensions {
            own: true,
            on: Some(vec![todos::ID.into(), "from-a-newer-app".into()]),
        };
        assert_eq!(on_for(&conn, &its_own, &none()).unwrap(), [todos::ID]);
    }

    #[test]
    fn a_call_gets_a_hosted_one_only_once_its_connected() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        save(&conn, "zapier", true).unwrap();
        save(&conn, "composio", true).unwrap();
        save(&conn, call_names::ID, false).unwrap();
        let follows = ProjectExtensions::default();
        assert_eq!(on_for(&conn, &follows, &none()).unwrap(), [todos::ID]);
        let connected = BTreeSet::from(["composio".to_owned()]);
        assert_eq!(
            on_for(&conn, &follows, &connected).unwrap(),
            [todos::ID, "composio"]
        );
        let data = for_call(&conn, 1, 1, &["composio".into()]).unwrap();
        assert_eq!(data["composio"], serde_json::json!({}));
    }

    #[test]
    fn settings_may_open_each_vendors_page() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../../capabilities/settings.json")).unwrap();
        let allowed: Vec<&str> = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["identifier"] == "opener:allow-open-url")
            .flat_map(|p| p["allow"].as_array().unwrap())
            .filter_map(|url| url["url"].as_str())
            .collect();
        for e in &CATALOGUE.extensions {
            if let Some(spec) = &e.connect {
                assert!(
                    allowed.contains(&spec.manage_url.as_str()),
                    "Settings may not open {}",
                    spec.manage_url
                );
            }
        }
    }
}
