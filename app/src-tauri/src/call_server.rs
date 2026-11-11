//! Which LiveKit server calls use: this Mac's or the user's own.

use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::blocking::blocking;
use crate::credentials::{KEYS_CHANGED, LiveKitKeys, Vault};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::local_server::LocalServer;
use crate::settings::{self, LiveKitServer};

fn chosen<R: Runtime>(app: &AppHandle<R>, db: &Db, vault: &Vault) -> Result<LiveKitServer> {
    let theirs = vault.livekit(app)?.is_some();
    settings::livekit_server(&*db.conn()?, theirs)
}

fn their_keys<R: Runtime>(app: &AppHandle<R>, vault: &Vault) -> Result<LiveKitKeys> {
    vault
        .livekit(app)?
        .ok_or_else(|| Error::Invalid("Add your LiveKit keys in Settings first.".into()))
}

pub fn for_new_call<R: Runtime>(
    app: &AppHandle<R>,
    db: &Db,
    vault: &Vault,
    local: &LocalServer,
) -> Result<LiveKitKeys> {
    match chosen(app, db, vault)? {
        LiveKitServer::ThisMac => local.ensure(),
        LiveKitServer::Theirs => {
            // One call at a time, so nothing is on this Mac's any more.
            local.stop();
            their_keys(app, vault)
        }
    }
}

/// Never starts this Mac's: fetching a token must only read.
pub fn current<R: Runtime>(
    app: &AppHandle<R>,
    db: &Db,
    vault: &Vault,
    local: &LocalServer,
) -> Result<LiveKitKeys> {
    match chosen(app, db, vault)? {
        LiveKitServer::ThisMac => local
            .current()
            .ok_or_else(|| Error::Invalid("Start the call again.".into())),
        LiveKitServer::Theirs => their_keys(app, vault),
    }
}

#[tauri::command]
pub async fn livekit_server<R: Runtime>(app: AppHandle<R>) -> Result<LiveKitServer> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        let vault = app.state::<Vault>();
        chosen(app, &db, &vault)
    })
    .await
}

/// Applies from the next call: each call keeps the server it opened with.
#[tauri::command]
pub async fn set_livekit_server<R: Runtime>(
    app: AppHandle<R>,
    server: LiveKitServer,
) -> Result<()> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        settings::save_livekit_server(&*db.conn()?, server)?;
        let _ = app.emit(KEYS_CHANGED, ());
        Ok(())
    })
    .await
}
