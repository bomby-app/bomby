//! Watching a folder while the workspace panel shows it, so the changes and the file tree
//! follow what the agent does live. FSEvents on macOS (notify), debounced so a burst of
//! writes is one nudge; the page then reads again what it shows.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use git2::Repository;
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

/// The repository's own folders for `folder`, if it's in one: its git folder (`.git`, or
/// `.git/worktrees/<name>` for a linked worktree) and the folder it shares with its
/// worktrees, where the branches live. Real paths, as the watcher reports them.
fn git_dirs(folder: &Path) -> Vec<PathBuf> {
    let Ok(repo) = Repository::discover(folder) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = [repo.path(), repo.commondir()]
        .into_iter()
        .filter_map(|dir| dir.canonicalize().ok())
        .collect();
    dirs.dedup();
    dirs
}

/// A change worth reading again. In the folder, anything but another repository's `.git`
/// (a submodule's, say). In the repository's own git folders, only what moves what the
/// panel shows: the index (`git add`), HEAD and the branches (a commit, a checkout).
/// Git's object and log writes would otherwise nudge for every agent's `git` run.
fn matters(path: &Path, git_dirs: &[PathBuf]) -> bool {
    if let Some(inside) = git_dirs.iter().find_map(|dir| path.strip_prefix(dir).ok()) {
        let mut parts = inside.components();
        return match (parts.next(), parts.next()) {
            (Some(Component::Normal(name)), None) => {
                name == "index" || name == "HEAD" || name == "packed-refs"
            }
            (Some(Component::Normal(name)), Some(_)) => name == "refs",
            _ => false,
        };
    }
    !path
        .components()
        .any(|c| c == Component::Normal(".git".as_ref()))
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
    let debouncer = watch(&folder, move || {
        let _ = changed.send(());
    })?;
    let id = watches.next.fetch_add(1, Ordering::Relaxed);
    sync::lock(&watches.open).insert(id, debouncer);
    Ok(id)
}

/// Calls `changed` after each burst of changes that [`matters`] in `folder`, and in its
/// repository's git folders when those are elsewhere: a project pointing at a folder inside
/// a repository, or a linked worktree, whose `.git` is only a file pointing at them.
fn watch(
    folder: &Path,
    changed: impl Fn() + Send + 'static,
) -> Result<Debouncer<RecommendedWatcher>> {
    let git = git_dirs(folder);
    let elsewhere: Vec<PathBuf> = folder.canonicalize().map_or_else(
        |_| git.clone(),
        |real| {
            git.iter()
                .filter(|d| !d.starts_with(&real))
                .cloned()
                .collect()
        },
    );
    let mut debouncer = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| {
        if let Ok(events) = result
            && events.iter().any(|e| matters(&e.path, &git))
        {
            changed();
        }
    })
    .map_err(watch_error)?;
    let watcher = debouncer.watcher();
    watcher
        .watch(folder, RecursiveMode::Recursive)
        .map_err(watch_error)?;
    for dir in &elsewhere {
        // Without it the panel still follows the folder's own files.
        let _ = watcher.watch(dir, RecursiveMode::Recursive);
    }
    Ok(debouncer)
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
    fn only_what_moves_the_panel_matters_inside_git() {
        let git = [
            PathBuf::from("/me/app/.git"),
            PathBuf::from("/me/main/.git"),
        ];
        let matters = |p: &str| matters(Path::new(p), &git);
        assert!(matters("/me/app/src/main.rs"));
        assert!(matters("/me/app/.github/ci.yml"));
        assert!(matters("/me/app/.git/index"));
        assert!(matters("/me/app/.git/HEAD"));
        assert!(matters("/me/main/.git/refs/heads/main"));
        assert!(matters("/me/main/.git/packed-refs"));
        assert!(!matters("/me/app/.git/objects/ab/cdef"));
        assert!(!matters("/me/app/.git/logs/HEAD"));
        assert!(!matters("/me/app/.git/index.lock"));
        // Another repository's, inside the folder: a submodule.
        assert!(!matters("/me/app/vendor/lib/.git/index"));
    }

    /// Waits up to `WAIT` for a nudge, after the watcher has had time to start.
    fn nudged(nudges: &std::sync::mpsc::Receiver<()>) -> bool {
        nudges.recv_timeout(Duration::from_secs(5)).is_ok()
    }

    fn settle(nudges: &std::sync::mpsc::Receiver<()>) {
        std::thread::sleep(Duration::from_millis(800));
        while nudges.try_recv().is_ok() {}
    }

    /// A project pointing at `repo/app`: its repository's index and HEAD are outside the
    /// watched folder, yet staging and committing change what the panel shows.
    #[test]
    fn staging_and_committing_nudge_a_folder_inside_a_repository() {
        use git2::{Repository, Signature};
        let dir = crate::workspace::tests::tempfile_dir("watch-git");
        let repo = Repository::init(&dir).unwrap();
        std::fs::create_dir(dir.join("app")).unwrap();
        std::fs::write(dir.join("app/a.txt"), "a\n").unwrap();

        let (tx, nudges) = std::sync::mpsc::channel();
        let _watch = watch(&dir.join("app"), move || {
            let _ = tx.send(());
        })
        .unwrap();
        settle(&nudges);

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("app/a.txt")).unwrap();
        index.write().unwrap();
        assert!(nudged(&nudges), "git add didn't nudge");

        settle(&nudges);
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let me = Signature::now("Me", "me@example.com").unwrap();
        repo.commit(Some("HEAD"), &me, &me, "first", &tree, &[])
            .unwrap();
        assert!(nudged(&nudges), "git commit didn't nudge");
    }
}
