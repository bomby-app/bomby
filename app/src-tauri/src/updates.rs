//! The app's version and its updates, for Settings, About (docs/releasing.md).
//!
//! Release builds check once at launch and when the user asks. An update comes from the
//! latest published GitHub release's `latest.json` (`plugins.updater` in tauri.conf.json),
//! signed with the updater key; the plugin checks that signature, and the version signed
//! into it, before installing. Only release builds load the plugin (lib.rs), so nothing
//! here calls it in a development build. Installing always waits for the user and for the call to
//! end, then restarts Bomby. Development builds show their version and never update.
//!
//! The page follows the status through `update-status` events, sent to every window.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{Error, Result};
use crate::{app_log, sync, tray};

const EVENT: &str = "update-status";

/// Where updating stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UpdateStatus {
    /// A development build (`just app dev`): it runs the repo, so it never updates.
    Development,
    /// Not checked yet.
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
    },
    /// Downloading `version`; `percent` once the size is known.
    Downloading {
        version: String,
        percent: Option<u8>,
    },
    /// Installed; Bomby is restarting into it.
    Restarting,
    /// What went wrong, for the user. The raw error is in app.log.
    Failed {
        message: String,
    },
}

/// The status, and the update a check found, ready to install.
pub struct Updates(Mutex<(UpdateStatus, Option<Update>)>);

impl Default for Updates {
    fn default() -> Self {
        let status = if cfg!(debug_assertions) {
            UpdateStatus::Development
        } else {
            UpdateStatus::Idle
        };
        Self(Mutex::new((status, None)))
    }
}

/// What Settings, About shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct About {
    /// `version` in tauri.conf.json, which a release's tag must match.
    pub version: String,
    pub status: UpdateStatus,
}

/// Checks for an update in the background, once, as a release build starts.
pub fn check_in_background<R: Runtime>(app: &AppHandle<R>) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = check(&app).await;
    });
}

#[tauri::command]
pub fn about<R: Runtime>(app: AppHandle<R>, updates: State<'_, Updates>) -> About {
    About {
        version: app.package_info().version.to_string(),
        status: sync::lock(&updates.0).0.clone(),
    }
}

#[tauri::command(async)]
pub async fn check_for_updates<R: Runtime>(app: AppHandle<R>) -> UpdateStatus {
    check(&app).await
}

/// Downloads and installs the update the last check found, then restarts Bomby.
#[tauri::command(async)]
pub async fn install_update<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    if tray::on_call(&app) {
        return Err(Error::Invalid(
            "Bomby restarts to update. End the call first.".into(),
        ));
    }
    let update = {
        let updates = app.state::<Updates>();
        let slot = sync::lock(&updates.0);
        match (&slot.0, &slot.1) {
            (UpdateStatus::Available { .. }, Some(update)) => update.clone(),
            _ => return Err(Error::Invalid("There's no update to install.".into())),
        }
    };

    let version = update.version.clone();
    set(
        &app,
        UpdateStatus::Downloading {
            version: version.clone(),
            percent: None,
        },
    );
    let mut downloaded: u64 = 0;
    let mut shown = None;
    let result = update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let percent = total
                    .filter(|total| *total > 0)
                    .map(|total| (downloaded.min(total) * 100 / total) as u8);
                // One event per percent, not per chunk.
                if percent != shown {
                    shown = percent;
                    set(
                        &app,
                        UpdateStatus::Downloading {
                            version: version.clone(),
                            percent,
                        },
                    );
                }
            },
            || {},
        )
        .await;

    match result {
        Ok(()) => {
            set(&app, UpdateStatus::Restarting);
            app.request_restart();
            Ok(())
        }
        Err(error) => {
            let _ = app_log::append(
                &app,
                &format!("update {version} failed to install: {error}"),
            );
            // The update is still there to try again.
            set(&app, UpdateStatus::Available { version });
            Err(Error::Invalid(
                "Bomby couldn't install the update. Check that it's in your Applications folder, then try again."
                    .into(),
            ))
        }
    }
}

async fn check<R: Runtime>(app: &AppHandle<R>) -> UpdateStatus {
    if cfg!(debug_assertions) {
        return UpdateStatus::Development;
    }
    {
        let updates = app.state::<Updates>();
        let slot = sync::lock(&updates.0);
        // A check or an install is already running; it reports when it's done.
        if matches!(
            slot.0,
            UpdateStatus::Checking | UpdateStatus::Downloading { .. } | UpdateStatus::Restarting
        ) {
            return slot.0.clone();
        }
    }
    set(app, UpdateStatus::Checking);

    let found = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    let (status, update) = match found {
        Ok(Some(update)) => (
            UpdateStatus::Available {
                version: update.version.clone(),
            },
            Some(update),
        ),
        Ok(None) => (UpdateStatus::UpToDate, None),
        Err(error) => {
            let _ = app_log::append(app, &format!("update check failed: {error}"));
            (
                UpdateStatus::Failed {
                    message: "Bomby couldn't check for updates. Try again later.".into(),
                },
                None,
            )
        }
    };
    *sync::lock(&app.state::<Updates>().0) = (status.clone(), update);
    let _ = app.emit(EVENT, &status);
    status
}

/// Records `status` and tells every window.
fn set<R: Runtime>(app: &AppHandle<R>, status: UpdateStatus) {
    sync::lock(&app.state::<Updates>().0).0 = status.clone();
    let _ = app.emit(EVENT, &status);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_reach_the_page_tagged_by_kind() {
        let available = UpdateStatus::Available {
            version: "0.2.0".into(),
        };
        assert_eq!(
            serde_json::to_value(&available).unwrap(),
            serde_json::json!({ "kind": "available", "version": "0.2.0" })
        );
        let downloading = UpdateStatus::Downloading {
            version: "0.2.0".into(),
            percent: Some(40),
        };
        assert_eq!(
            serde_json::to_value(&downloading).unwrap(),
            serde_json::json!({ "kind": "downloading", "version": "0.2.0", "percent": 40 })
        );
        assert_eq!(
            serde_json::to_value(UpdateStatus::UpToDate).unwrap(),
            serde_json::json!({ "kind": "upToDate" })
        );
    }
}
