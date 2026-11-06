//! A folder's files for the workspace panel's tree, one directory at a time as the user
//! opens it, and a file's text for its preview. Files git ignores are listed but marked,
//! so the tree can dim them; `.git` itself is left out.

use std::fs;
use std::io::Read;
use std::path::Path;

use git2::Repository;
use serde::Serialize;
use tauri::State;

use super::{inside, project_folder};
use crate::db::Db;
use crate::error::Result;

/// The most of a file the preview reads.
const MAX_PREVIEW_BYTES: u64 = 512 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "workspace.ts"))]
pub struct Entry {
    name: String,
    /// From the folder, with `/`; what the page sends back to open it.
    path: String,
    dir: bool,
    /// Git ignores it (`node_modules`, build output).
    ignored: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "workspace.ts"))]
pub struct FilePreview {
    /// `None` when the file isn't shown: binary, or too large.
    text: Option<String>,
    size: u64,
}

pub(crate) fn entries(folder: &Path, dir: &str) -> Result<Vec<Entry>> {
    let dir = dir.trim_matches('/');
    let path = inside(folder, dir)?;
    let repo = Repository::discover(folder).ok();
    let workdir = repo
        .as_ref()
        .and_then(Repository::workdir)
        .and_then(|w| w.canonicalize().ok());
    let real = path.canonicalize()?;

    let mut entries = Vec::new();
    for item in fs::read_dir(&path)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        // A symlink to a folder opens like one; a broken one reads as a file.
        let is_dir = fs::metadata(item.path()).is_ok_and(|m| m.is_dir());
        let ignored = match (&repo, &workdir) {
            (Some(repo), Some(workdir)) => real
                .join(&name)
                .strip_prefix(workdir)
                .is_ok_and(|p| repo.is_path_ignored(p).unwrap_or(false)),
            _ => false,
        };
        let path = if dir.is_empty() {
            name.clone()
        } else {
            format!("{dir}/{name}")
        };
        entries.push(Entry {
            name,
            path,
            dir: is_dir,
            ignored,
        });
    }
    entries.sort_by(|a, b| {
        b.dir
            .cmp(&a.dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub(crate) fn preview(folder: &Path, file: &str) -> Result<FilePreview> {
    let path = inside(folder, file)?;
    let size = fs::metadata(&path)?.len();
    if size > MAX_PREVIEW_BYTES {
        return Ok(FilePreview { text: None, size });
    }
    let mut bytes = Vec::with_capacity(usize::try_from(size).unwrap_or(0));
    fs::File::open(&path)?
        .take(MAX_PREVIEW_BYTES)
        .read_to_end(&mut bytes)?;
    // Git's own test for binary: a NUL in the first 8000 bytes.
    let binary = bytes.iter().take(8000).any(|b| *b == 0);
    let text = (!binary).then(|| String::from_utf8(bytes).ok()).flatten();
    Ok(FilePreview { text, size })
}

/// One directory of a project's folder: `dir` is `""` for the folder itself.
#[tauri::command(async)]
pub fn folder_entries(
    db: State<'_, Db>,
    project_id: i64,
    folder: String,
    dir: String,
) -> Result<Vec<Entry>> {
    let folder = project_folder(&db.conn(), project_id, &folder)?;
    entries(&folder, &dir)
}

/// A file in a project's folder, for the preview.
#[tauri::command(async)]
pub fn folder_file(
    db: State<'_, Db>,
    project_id: i64,
    folder: String,
    file: String,
) -> Result<FilePreview> {
    let folder = project_folder(&db.conn(), project_id, &folder)?;
    preview(&folder, &file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::tempfile_dir;

    #[test]
    fn lists_folders_first_and_marks_what_git_ignores() {
        let dir = tempfile_dir("entries");
        Repository::init(&dir).unwrap();
        fs::write(dir.join(".gitignore"), "build/\n").unwrap();
        fs::write(dir.join("Zed.md"), "").unwrap();
        fs::write(dir.join("apple.md"), "").unwrap();
        fs::create_dir_all(dir.join("build")).unwrap();
        fs::create_dir_all(dir.join("src/inner")).unwrap();
        fs::write(dir.join("src/main.rs"), "").unwrap();

        let top = entries(&dir, "").unwrap();
        let names: Vec<_> = top.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["build", "src", ".gitignore", "apple.md", "Zed.md"]);
        assert!(top[0].dir && top[0].ignored);
        assert!(top[1].dir && !top[1].ignored);

        let src = entries(&dir, "src").unwrap();
        let paths: Vec<_> = src.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["src/inner", "src/main.rs"]);
        assert!(entries(&dir, "..").is_err());
    }

    #[test]
    fn previews_text_but_not_binary_or_large_files() {
        let dir = tempfile_dir("preview");
        fs::write(dir.join("a.txt"), "hello\n").unwrap();
        fs::write(dir.join("b.bin"), [0u8, 1, 2]).unwrap();
        fs::write(
            dir.join("big.txt"),
            "x".repeat(usize::try_from(MAX_PREVIEW_BYTES).unwrap() + 1),
        )
        .unwrap();
        assert_eq!(
            preview(&dir, "a.txt").unwrap().text.as_deref(),
            Some("hello\n")
        );
        assert!(preview(&dir, "b.bin").unwrap().text.is_none());
        assert!(preview(&dir, "big.txt").unwrap().text.is_none());
    }
}
