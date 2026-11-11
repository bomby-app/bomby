//! The workspace panel beside a project: its folders' git changes, their files and
//! terminals in them. The page only ever names a project and one of its folders; every
//! command checks the folder is the project's and still there ([`project_folder`]), and
//! paths inside it stay inside it ([`inside`]).

pub mod changes;
pub mod files;
pub mod terminals;
pub mod watch;

use std::path::{Component, Path, PathBuf};

use crate::db::Db;
use crate::error::{Error, Result};
use crate::projects;

/// `folder` as one of project `id`'s folders that is still on disk. The disk is checked
/// once the database is free again: a sleeping or unreachable volume can hold up a `stat`
/// for seconds, and nothing else should wait on it.
pub(crate) fn project_folder(db: &Db, id: i64, folder: &str) -> Result<PathBuf> {
    let folders = projects::folders(&*db.conn()?, id)?;
    if !folders.iter().any(|f| f == folder) {
        return Err(Error::NotFound("folder"));
    }
    let path = PathBuf::from(folder);
    if !path.is_dir() {
        let name = path
            .file_name()
            .map_or_else(|| folder.into(), |n| n.to_string_lossy());
        return Err(Error::Invalid(format!(
            "The folder {name} isn't there any more. Add it again in Project settings."
        )));
    }
    Ok(path)
}

/// `relative` (a `/`-separated path the page sent, `""` for the folder itself) under
/// `folder`, as its real path, refusing anything that would leave it: absolute paths,
/// `..`, and symlinks that point outside.
pub(crate) fn inside(folder: &Path, relative: &str) -> Result<PathBuf> {
    let outside = || Error::Invalid(format!("{relative} isn't in this folder."));
    let relative = Path::new(relative);
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(outside());
    }
    let real = folder.join(relative).canonicalize()?;
    if !real.starts_with(folder.canonicalize()?) {
        return Err(outside());
    }
    // The path that was checked, links resolved, so a read can't follow a link swapped in
    // after the check. A program swapping a folder above it in that instant could still
    // win; such a program runs as the user and can read the file anyway, and the preview
    // only shows the user their own files.
    Ok(real)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn inside_keeps_paths_in_the_folder() {
        let dir = tempfile_dir("inside");
        std::fs::create_dir_all(dir.join("src")).unwrap();
        assert_eq!(inside(&dir, "src").unwrap(), dir.join("src"));
        assert_eq!(inside(&dir, "").unwrap(), dir);
        assert!(inside(&dir, "../").is_err());
        assert!(inside(&dir, "src/../..").is_err());
        assert!(inside(&dir, "/etc").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/", dir.join("root")).unwrap();
            assert!(inside(&dir, "root").is_err());
            // A link inside resolves to what it points at, the path that was checked.
            std::os::unix::fs::symlink(dir.join("src"), dir.join("alias")).unwrap();
            assert_eq!(inside(&dir, "alias").unwrap(), dir.join("src"));
        }
    }

    #[test]
    fn project_folder_is_only_the_projects_own() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        let dir = tempfile_dir("project-folder");
        let folder = dir.to_string_lossy().into_owned();
        conn.execute(
            "INSERT INTO projects (name, instructions, created_at) VALUES ('samba', '', 0)",
            [],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO project_folders (project_id, position, path) VALUES (?1, 0, ?2)",
            rusqlite::params![id, folder],
        )
        .unwrap();
        drop(conn);
        assert_eq!(project_folder(&db, id, &folder).unwrap(), dir);
        assert!(matches!(
            project_folder(&db, id, "/tmp"),
            Err(Error::NotFound("folder"))
        ));
        std::fs::remove_dir_all(&dir).unwrap();
        let gone = project_folder(&db, id, &folder).unwrap_err().to_string();
        assert!(gone.contains("isn't there any more"), "{gone}");
    }

    /// A fresh empty folder under the system's temp folder, unique to this test.
    pub(crate) fn tempfile_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("bomby-workspace-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }
}
