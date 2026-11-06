//! Watching a folder while the workspace panel shows it, so the changes and the file tree
//! follow what the agent does live. FSEvents on macOS (notify), debounced so a burst of
//! writes is one nudge; the page then reads again what it shows.

use std::collections::HashMap;
use std::path::{Component, Path};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use tauri::State;
use tauri::ipc::Channel;

use super::project_folder;
use crate::db::Db;
use crate::error::{Error, Result};
use crate::sync;

/// Quiet time after the last write before the page hears of it.
const DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Default)]
pub struct Watches {
    next: AtomicU32,
    open: Mutex<HashMap<u32, Debouncer<RecommendedWatcher>>>,
}

/// A change worth reading again: anything outside `.git`, and in it only what moves the
/// working tree's state (the index and HEAD, as a commit, checkout or `git add` does).
/// Git's object and log writes would otherwise nudge for every agent's `git` run.
fn matters(path: &Path) -> bool {
    let mut parts = path
        .components()
        .skip_while(|c| *c != Component::Normal(".git".as_ref()));
    if parts.next().is_none() {
        return true;
    }
    matches!(
        parts.next(),
        Some(Component::Normal(name)) if name == "index" || name == "HEAD"
    )
}

/// Watches one of a project's folders; `changed` gets `null` after each burst of changes.
/// Returns the id `unwatch_folder` stops it with.
#[tauri::command(async)]
pub fn watch_folder(
    db: State<'_, Db>,
    watches: State<'_, Watches>,
    project_id: i64,
    folder: String,
    changed: Channel<()>,
) -> Result<u32> {
    let folder = project_folder(&db.conn(), project_id, &folder)?;
    let mut debouncer = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| {
        if let Ok(events) = result
            && events.iter().any(|e| matters(&e.path))
        {
            let _ = changed.send(());
        }
    })
    .map_err(watch_error)?;
    debouncer
        .watcher()
        .watch(&folder, RecursiveMode::Recursive)
        .map_err(watch_error)?;
    let id = watches.next.fetch_add(1, Ordering::Relaxed);
    sync::lock(&watches.open).insert(id, debouncer);
    Ok(id)
}

fn watch_error(e: impl std::fmt::Display) -> Error {
    Error::Invalid(format!("Bomby couldn't follow changes in this folder: {e}"))
}

/// Stops a watch; dropping the debouncer stops its watcher. Stopping one that's gone is fine.
#[tauri::command(async)]
pub fn unwatch_folder(watches: State<'_, Watches>, id: u32) {
    let stopped = sync::lock(&watches.open).remove(&id);
    drop(stopped);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_index_and_head_matter_inside_git() {
        assert!(matters(Path::new("/me/app/src/main.rs")));
        assert!(matters(Path::new("/me/app/.github/ci.yml")));
        assert!(matters(Path::new("/me/app/.git/index")));
        assert!(matters(Path::new("/me/app/.git/HEAD")));
        assert!(!matters(Path::new("/me/app/.git/objects/ab/cdef")));
        assert!(!matters(Path::new("/me/app/.git/logs/HEAD")));
        assert!(!matters(Path::new("/me/app/.git/index.lock")));
    }
}
