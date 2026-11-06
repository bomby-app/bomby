//! What changed in a folder's git repository: every file that differs from the last
//! commit, staged or not, new files included, each with its own unified patch that the
//! page renders with Pierre's diffs. libgit2 (git2, built into the app) reads the
//! repository, so the user needs no git of their own. Ignored files stay out, as in
//! `git status`.

use std::path::Path;

use git2::{Delta, DiffFindOptions, DiffOptions, ErrorCode, Patch, Repository};
use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::error::Result;

/// Files bigger than this show as changed but without their lines.
const MAX_FILE_BYTES: i64 = 1024 * 1024;
/// Patches past this many bytes in all are left out, so a huge change can't stall the page.
const MAX_PATCH_BYTES: usize = 4 * 1024 * 1024;

/// Whether a folder is in a git repository, and on which branch.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "workspace.ts"))]
pub struct FolderInfo {
    repo: bool,
    /// The branch's name, the short commit when detached, `None` outside a repository.
    branch: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "workspace.ts"))]
pub struct Changes {
    /// The folder's place in the repository, with `/`: `""` at its root, `app` for a
    /// folder inside. File paths start with it, so the page can find them in the folder.
    within: String,
    /// In git's order: by path.
    files: Vec<ChangedFile>,
    /// Some patches were left out for size ([`MAX_PATCH_BYTES`]).
    truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "workspace.ts"))]
pub struct ChangedFile {
    /// From the repository's root, with `/`.
    path: String,
    /// Where a renamed file was.
    old_path: Option<String>,
    status: ChangeStatus,
    additions: u32,
    deletions: u32,
    /// The file's unified patch (`diff --git` header and hunks); empty for a binary or
    /// too-large file, or one left out for size.
    patch: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "workspace.ts"))]
pub enum ChangeStatus {
    /// New and staged.
    Added,
    /// New and not staged: git doesn't track it yet.
    Untracked,
    Modified,
    Deleted,
    Renamed,
    /// A file became a symlink or the other way round.
    Typechange,
}

fn repository(folder: &Path) -> Option<Repository> {
    Repository::discover(folder).ok().filter(|r| !r.is_bare())
}

fn branch(repo: &Repository) -> Option<String> {
    match repo.head() {
        Ok(head) if head.is_branch() => head.shorthand().ok().map(str::to_owned),
        Ok(head) => head
            .target()
            .map(|oid| oid.to_string().chars().take(7).collect()),
        // A new repository: HEAD names a branch with no commit yet.
        Err(e) if e.code() == ErrorCode::UnbornBranch => repo
            .find_reference("HEAD")
            .ok()?
            .symbolic_target()
            .ok()
            .flatten()
            .map(|t| t.trim_start_matches("refs/heads/").to_owned()),
        Err(_) => None,
    }
}

pub(crate) fn info(folder: &Path) -> FolderInfo {
    let repo = repository(folder);
    FolderInfo {
        repo: repo.is_some(),
        branch: repo.as_ref().and_then(branch),
    }
}

fn path_string(path: Option<&Path>) -> String {
    path.map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/// The changes under `folder`, which may be the repository's root or a folder in it.
/// `None` outside a repository.
pub(crate) fn changes(folder: &Path) -> Result<Option<Changes>> {
    let Some(repo) = repository(folder) else {
        return Ok(None);
    };
    let head = match repo.head() {
        Ok(head) => Some(head.peel_to_tree()?),
        Err(e) if matches!(e.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound) => None,
        Err(e) => return Err(e.into()),
    };

    let mut options = DiffOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true)
        .include_typechange(true)
        .max_size(MAX_FILE_BYTES);
    // Only this folder's part of the repository.
    let mut within = String::new();
    if let Some(workdir) = repo.workdir()
        && let Ok(under) = folder.canonicalize()?.strip_prefix(workdir.canonicalize()?)
        && !under.as_os_str().is_empty()
    {
        within = path_string(Some(under));
        options.pathspec(under).disable_pathspec_match(true);
    }
    let mut diff = repo.diff_tree_to_workdir_with_index(head.as_ref(), Some(&mut options))?;
    diff.find_similar(Some(
        DiffFindOptions::new().renames(true).for_untracked(true),
    ))?;

    let mut files = Vec::with_capacity(diff.deltas().len());
    let mut total = 0;
    let mut truncated = false;
    for (index, delta) in diff.deltas().enumerate() {
        let status = match delta.status() {
            Delta::Added | Delta::Copied => ChangeStatus::Added,
            Delta::Untracked => ChangeStatus::Untracked,
            Delta::Deleted => ChangeStatus::Deleted,
            Delta::Renamed => ChangeStatus::Renamed,
            Delta::Typechange => ChangeStatus::Typechange,
            Delta::Modified => ChangeStatus::Modified,
            Delta::Unmodified | Delta::Ignored | Delta::Unreadable | Delta::Conflicted => continue,
        };
        let path = path_string(delta.new_file().path().or(delta.old_file().path()));
        let old_path =
            (status == ChangeStatus::Renamed).then(|| path_string(delta.old_file().path()));

        let mut file = ChangedFile {
            path,
            old_path,
            status,
            additions: 0,
            deletions: 0,
            patch: String::new(),
        };
        if let Some(mut patch) = Patch::from_diff(&diff, index)? {
            let (_, additions, deletions) = patch.line_stats()?;
            file.additions = u32::try_from(additions).unwrap_or(u32::MAX);
            file.deletions = u32::try_from(deletions).unwrap_or(u32::MAX);
            if !delta.flags().is_binary() && patch.size(true, true, true) > 0 {
                let text = String::from_utf8_lossy(&patch.to_buf()?).into_owned();
                if total + text.len() > MAX_PATCH_BYTES {
                    truncated = true;
                } else {
                    total += text.len();
                    file.patch = text;
                }
            }
        }
        files.push(file);
    }
    Ok(Some(Changes {
        within,
        files,
        truncated,
    }))
}

/// Whether one of a project's folders is in a git repository.
#[tauri::command(async)]
pub fn folder_info(db: State<'_, Db>, project_id: i64, folder: String) -> Result<FolderInfo> {
    let folder = super::project_folder(&db.conn(), project_id, &folder)?;
    Ok(info(&folder))
}

/// What changed in one of a project's folders since the last commit; `None` outside git.
#[tauri::command(async)]
pub fn folder_changes(
    db: State<'_, Db>,
    project_id: i64,
    folder: String,
) -> Result<Option<Changes>> {
    let folder = super::project_folder(&db.conn(), project_id, &folder)?;
    changes(&folder)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::workspace::tests::tempfile_dir;

    fn commit_all(repo: &Repository, message: &str) {
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let me = git2::Signature::now("Me", "me@example.com").unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<_> = parent.iter().collect();
        repo.commit(Some("HEAD"), &me, &me, message, &tree, &parents)
            .unwrap();
    }

    #[test]
    fn a_plain_folder_has_no_changes() {
        let dir = tempfile_dir("plain");
        assert!(!info(&dir).repo);
        assert!(changes(&dir).unwrap().is_none());
    }

    #[test]
    fn lists_edits_new_and_deleted_files_with_their_patches() {
        let dir = tempfile_dir("changes");
        let repo = Repository::init(&dir).unwrap();
        fs::write(dir.join("keep.txt"), "one\ntwo\n").unwrap();
        fs::write(dir.join("gone.txt"), "bye\n").unwrap();
        fs::write(dir.join(".gitignore"), "ignored.txt\n").unwrap();
        commit_all(&repo, "first");

        fs::write(dir.join("keep.txt"), "one\nthree\n").unwrap();
        fs::remove_file(dir.join("gone.txt")).unwrap();
        fs::create_dir(dir.join("src")).unwrap();
        fs::write(dir.join("src/new.rs"), "fn main() {}\n").unwrap();
        fs::write(dir.join("ignored.txt"), "secret\n").unwrap();

        let changes = changes(&dir).unwrap().unwrap();
        let by_path = |p: &str| changes.files.iter().find(|f| f.path == p).unwrap();
        assert_eq!(changes.files.len(), 3, "{:?}", changes.files);
        let keep = by_path("keep.txt");
        assert_eq!(keep.status, ChangeStatus::Modified);
        assert_eq!((keep.additions, keep.deletions), (1, 1));
        assert!(keep.patch.starts_with("diff --git a/keep.txt b/keep.txt"));
        assert!(keep.patch.contains("-two\n+three\n"));
        assert_eq!(by_path("gone.txt").status, ChangeStatus::Deleted);
        let new = by_path("src/new.rs");
        assert_eq!(new.status, ChangeStatus::Untracked);
        assert!(new.patch.contains("+fn main() {}"));
        assert!(!changes.truncated);
        assert_eq!(changes.within, "");
    }

    #[test]
    fn a_staged_new_file_is_added() {
        let dir = tempfile_dir("staged");
        let repo = Repository::init(&dir).unwrap();
        fs::write(dir.join("a.txt"), "a\n").unwrap();
        commit_all(&repo, "first");
        fs::write(dir.join("b.txt"), "b\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("b.txt")).unwrap();
        index.write().unwrap();
        let changes = changes(&dir).unwrap().unwrap();
        assert_eq!(changes.files[0].status, ChangeStatus::Added);
    }

    #[test]
    fn a_folder_inside_a_repository_shows_only_its_part() {
        let dir = tempfile_dir("subfolder");
        let repo = Repository::init(&dir).unwrap();
        fs::create_dir(dir.join("app")).unwrap();
        fs::write(dir.join("app/a.txt"), "a\n").unwrap();
        fs::write(dir.join("b.txt"), "b\n").unwrap();
        commit_all(&repo, "first");
        fs::write(dir.join("app/a.txt"), "aa\n").unwrap();
        fs::write(dir.join("b.txt"), "bb\n").unwrap();

        let changes = changes(&dir.join("app")).unwrap().unwrap();
        let paths: Vec<_> = changes.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["app/a.txt"]);
        assert_eq!(changes.within, "app");
        assert_eq!(
            info(&dir.join("app")).branch.as_deref(),
            branch(&repo).as_deref()
        );
    }

    #[test]
    fn a_new_repository_names_its_branch_and_lists_every_file() {
        let dir = tempfile_dir("unborn");
        let repo = Repository::init(&dir).unwrap();
        fs::write(dir.join("hello.txt"), "hi\n").unwrap();
        let info = info(&dir);
        assert!(info.repo);
        assert!(info.branch.is_some());
        let changes = changes(&dir).unwrap().unwrap();
        assert_eq!(changes.files.len(), 1);
        assert_eq!(changes.files[0].status, ChangeStatus::Untracked);
        drop(repo);
    }
}
