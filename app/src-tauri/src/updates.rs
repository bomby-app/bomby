//! The app's version and its updates, for Settings, About (docs/releasing.md).
//!
//! Release builds check once at launch and when the user asks. An update comes from the
//! latest published GitHub release's `latest.json` (`plugins.updater` in tauri.conf.json),
//! signed with the updater key; the plugin checks that signature, and the version signed
//! into it, before installing. Only release builds load the plugin (lib.rs), so nothing
//! here calls it in a development build, which shows its version and never updates.
//!
//! Installing waits for the user and never cuts off a call. The core itself tracks calls,
//! under the same lock as the update: `calls::open_call` holds a `CallOpening` while it
//! opens one and records it, `calls::end_call` forgets it. Installing is refused while a
//! call is on, a call that starts during the download keeps the update waiting until the
//! user restarts, and once Bomby is restarting no call can open.
//!
//! The page follows the status through `update-status` events, sent to every window.

use std::collections::HashSet;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{Error, Result};
use crate::{app_log, sync};

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
    /// Downloaded and checked, waiting for a restart (a call started during the download).
    Downloaded {
        version: String,
    },
    /// Installed; Bomby is restarting into it.
    Restarting,
    /// What went wrong, for the user. The raw error is in app.log.
    Failed {
        message: String,
    },
}

/// The status, the update a check found and its bytes once downloaded, and the calls an
/// install must wait for.
struct Slot {
    status: UpdateStatus,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
    /// Calls being opened right now (`CallOpening`).
    opening: usize,
    /// Calls opened and not ended yet.
    calls: HashSet<i64>,
}

impl Slot {
    fn on_call(&self) -> bool {
        self.opening > 0 || !self.calls.is_empty()
    }
}

pub struct Updates(Mutex<Slot>);

impl Default for Updates {
    fn default() -> Self {
        let status = if cfg!(debug_assertions) {
            UpdateStatus::Development
        } else {
            UpdateStatus::Idle
        };
        Self(Mutex::new(Slot {
            status,
            update: None,
            bytes: None,
            opening: 0,
            calls: HashSet::new(),
        }))
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

/// A call being opened (`calls::open_call`). While it's held, an update waits rather than
/// restart; `opened` records the call until `call_ended`.
pub struct CallOpening<'a, R: Runtime> {
    app: &'a AppHandle<R>,
}

impl<'a, R: Runtime> CallOpening<'a, R> {
    /// Refused while Bomby is restarting into an update.
    pub fn begin(app: &'a AppHandle<R>) -> Result<Self> {
        let updates = app.state::<Updates>();
        let mut slot = sync::lock(&updates.0);
        if slot.status == UpdateStatus::Restarting {
            return Err(Error::Invalid(
                "Bomby is restarting to update. Start the call again in a moment.".into(),
            ));
        }
        slot.opening += 1;
        Ok(Self { app })
    }

    /// The call opened: an update waits until it ends.
    pub fn opened(self, call_id: i64) {
        sync::lock(&self.app.state::<Updates>().0)
            .calls
            .insert(call_id);
    }
}

impl<R: Runtime> Drop for CallOpening<'_, R> {
    fn drop(&mut self) {
        let updates = self.app.state::<Updates>();
        let mut slot = sync::lock(&updates.0);
        slot.opening = slot.opening.saturating_sub(1);
    }
}

/// The call ended: an update no longer waits for it.
pub fn call_ended<R: Runtime>(app: &AppHandle<R>, call_id: i64) {
    sync::lock(&app.state::<Updates>().0).calls.remove(&call_id);
}

#[tauri::command]
pub fn about<R: Runtime>(app: AppHandle<R>, updates: State<'_, Updates>) -> About {
    About {
        version: app.package_info().version.to_string(),
        status: sync::lock(&updates.0).status.clone(),
    }
}

#[tauri::command(async)]
pub async fn check_for_updates<R: Runtime>(app: AppHandle<R>) -> UpdateStatus {
    check(&app).await
}

/// Downloads the update the last check found (unless it already is), then installs it and
/// restarts Bomby, unless a call started meanwhile.
#[tauri::command(async)]
pub async fn install_update<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    let (update, bytes) = {
        let updates = app.state::<Updates>();
        let slot = sync::lock(&updates.0);
        if slot.on_call() {
            return Err(end_the_call_first());
        }
        match (&slot.status, &slot.update) {
            (UpdateStatus::Available { .. } | UpdateStatus::Downloaded { .. }, Some(update)) => {
                (update.clone(), slot.bytes.clone())
            }
            _ => return Err(Error::Invalid("There's no update to install.".into())),
        }
    };
    let version = update.version.clone();

    let bytes = match bytes {
        Some(bytes) => bytes,
        None => match download(&app, &update).await {
            Ok(bytes) => bytes,
            Err(error) => {
                let _ = app_log::append(
                    &app,
                    &format!("update {version} failed to download: {error}"),
                );
                set(&app, UpdateStatus::Available { version });
                return Err(Error::Invalid(
                    "Bomby couldn't download the update. Check your connection, then try again."
                        .into(),
                ));
            }
        },
    };

    // Ready to install. A call that started during the download keeps it waiting.
    {
        let updates = app.state::<Updates>();
        let mut slot = sync::lock(&updates.0);
        slot.bytes = Some(bytes.clone());
        slot.status = if slot.on_call() {
            UpdateStatus::Downloaded {
                version: version.clone(),
            }
        } else {
            // From here, `open_call` refuses new calls.
            UpdateStatus::Restarting
        };
        let _ = app.emit(EVENT, &slot.status);
        if slot.status != UpdateStatus::Restarting {
            return Ok(());
        }
    }

    match update.install(&bytes) {
        Ok(()) => {
            app.request_restart();
            Ok(())
        }
        Err(error) => {
            let _ = app_log::append(
                &app,
                &format!("update {version} failed to install: {error}"),
            );
            // The download is kept, to try again.
            set(&app, UpdateStatus::Downloaded { version });
            Err(Error::Invalid(
                "Bomby couldn't install the update. Check that it's in your Applications folder, then try again."
                    .into(),
            ))
        }
    }
}

fn end_the_call_first() -> Error {
    Error::Invalid("Bomby restarts to update. End the call first.".into())
}

/// Downloads `update` and checks its signature, reporting progress.
async fn download<R: Runtime>(
    app: &AppHandle<R>,
    update: &Update,
) -> std::result::Result<Vec<u8>, tauri_plugin_updater::Error> {
    let version = update.version.clone();
    set(
        app,
        UpdateStatus::Downloading {
            version: version.clone(),
            percent: None,
        },
    );
    let mut downloaded: u64 = 0;
    let mut shown = None;
    update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let percent = total
                    .filter(|total| *total > 0)
                    .map(|total| (downloaded.min(total) * 100 / total) as u8);
                // One event per percent, not per chunk.
                if percent != shown {
                    shown = percent;
                    set(
                        app,
                        UpdateStatus::Downloading {
                            version: version.clone(),
                            percent,
                        },
                    );
                }
            },
            || {},
        )
        .await
}

async fn check<R: Runtime>(app: &AppHandle<R>) -> UpdateStatus {
    if cfg!(debug_assertions) {
        return UpdateStatus::Development;
    }
    {
        let updates = app.state::<Updates>();
        let slot = sync::lock(&updates.0);
        // A check or an install is running, or an update is downloaded and waiting: keep it.
        if matches!(
            slot.status,
            UpdateStatus::Checking
                | UpdateStatus::Downloading { .. }
                | UpdateStatus::Downloaded { .. }
                | UpdateStatus::Restarting
        ) {
            return slot.status.clone();
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
    {
        let updates = app.state::<Updates>();
        let mut slot = sync::lock(&updates.0);
        slot.status = status.clone();
        slot.update = update;
        slot.bytes = None;
    }
    let _ = app.emit(EVENT, &status);
    status
}

/// Records `status` and tells every window.
fn set<R: Runtime>(app: &AppHandle<R>, status: UpdateStatus) {
    sync::lock(&app.state::<Updates>().0).status = status.clone();
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
            serde_json::to_value(UpdateStatus::Downloaded {
                version: "0.2.0".into()
            })
            .unwrap(),
            serde_json::json!({ "kind": "downloaded", "version": "0.2.0" })
        );
        assert_eq!(
            serde_json::to_value(UpdateStatus::UpToDate).unwrap(),
            serde_json::json!({ "kind": "upToDate" })
        );
    }
}
