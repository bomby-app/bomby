//! Where Bomby keeps its data (`bomby.db`, the adapters, the LiveKit server's files) and its
//! logs: the app's own folders, or the smoke check's ([`crate::smoke`]). Tauri state, set
//! once at launch, so everything reads the same place.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

use crate::error::{Error, Result};

pub struct Dirs {
    pub data: PathBuf,
    pub logs: PathBuf,
}

impl Dirs {
    /// `~/Library/Application Support/app.bomby.desktop` and `~/Library/Logs/app.bomby.desktop`
    /// on macOS, or `data` and `logs` in the smoke check's folder.
    pub fn for_app<R: Runtime>(app: &AppHandle<R>) -> Result<Self> {
        Ok(match crate::smoke::dir() {
            Some(dir) => Self {
                data: dir.join("data"),
                logs: dir.join("logs"),
            },
            None => Self {
                data: app.path().app_data_dir()?,
                logs: app.path().app_log_dir()?,
            },
        })
    }
}

/// The log folder.
pub fn logs<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    app.try_state::<Dirs>()
        .map(|dirs| dirs.logs.clone())
        .ok_or_else(|| Error::Invalid("Bomby's folders aren't set yet.".into()))
}
