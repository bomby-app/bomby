//! The launch smoke check (`just app smoke`, docs/releasing.md): a built Bomby started with
//! `BOMBY_SMOKE_DIR` set to an empty folder proves it launches, then quits. Release builds
//! honour it too, since a release is what it checks.
//!
//! In that run Bomby keeps its database and logs in that folder, keeps keys in memory and
//! never reads or writes the keychain, finds no coding agent (so it starts no agent and no
//! login shell), and doesn't check for updates or update the adapters: no keys, no agents
//! and no network needed, and nothing of the user's touched.
//!
//! It passes when both halves say so: the main window rendered and its own read of the
//! agents answered (`main_window_ready`), and the core's first look for the agents
//! finished. Bomby then writes `smoke.json` there and exits 0. A launch that hangs never
//! gets there, and the recipe's timeout fails it.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::sync;

const DIR_ENV: &str = "BOMBY_SMOKE_DIR";
/// What a passing run writes in the folder.
pub const RESULT_FILE: &str = "smoke.json";

/// The smoke check's folder, when this run is one: an absolute path.
pub fn dir() -> Option<PathBuf> {
    std::env::var_os(DIR_ENV)
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
}

/// Whether this run is the smoke check.
pub fn active() -> bool {
    dir().is_some()
}

/// What each half has said so far. Tauri state.
#[derive(Default)]
pub struct Smoke(Mutex<Said>);

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Said {
    /// What the main window rendered (`splash` or `workspace`) and how many agents its
    /// read of them answered with.
    page: Option<PageReady>,
    /// How many agents the core's first look found, once it finished.
    core_agents: Option<usize>,
}

#[derive(Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "launch.ts"))]
pub struct PageReady {
    pub rendered: String,
    pub agents: u32,
}

/// The main window rendered and read the agents.
pub fn page_ready<R: Runtime>(app: &AppHandle<R>, page: PageReady) {
    let _ = crate::app_log::append(
        app,
        &format!(
            "main window ready: {}, {} agents",
            page.rendered, page.agents
        ),
    );
    said(app, |s| s.page = Some(page));
}

/// The core's first look for the agents finished.
pub fn core_ready<R: Runtime>(app: &AppHandle<R>, agents: usize) {
    said(app, |s| s.core_agents = Some(agents));
}

fn said<R: Runtime>(app: &AppHandle<R>, say: impl FnOnce(&mut Said)) {
    let Some(dir) = dir() else { return };
    let smoke = app.state::<Smoke>();
    let mut said = sync::lock(&smoke.0);
    say(&mut said);
    if said.page.is_none() || said.core_agents.is_none() {
        return;
    }
    let written = serde_json::to_vec_pretty(&*said)
        .map_err(std::io::Error::other)
        .and_then(|json| std::fs::write(dir.join(RESULT_FILE), json));
    drop(said);
    match written {
        Ok(()) => app.exit(0),
        Err(e) => {
            let _ = crate::app_log::append(app, &format!("smoke check: {e}"));
            app.exit(1);
        }
    }
}
