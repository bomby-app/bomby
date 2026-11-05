//! Which LiveKit server calls use, this Mac's or the user's own
//! (docs/decisions/livekit-on-this-mac-or-cloud.md), and how a call reaches it: its URL and
//! keys. The choice is a setting (`settings::livekit_server`); the page reads and changes it
//! here.
//!
//! A change applies from the next call: each call keeps the server it opened with
//! (`calls::CallAgents`). Moving to the user's own stops this Mac's server once no call can
//! still be on it, when the next call opens.

use tauri::{AppHandle, Emitter, Runtime, State};

use crate::credentials::{KEYS_CHANGED, LiveKitKeys, Vault};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::local_server::LocalServer;
use crate::settings::{self, LiveKitServer};

/// The server the setting names, with whether the user's own keys are saved for the default.
fn chosen<R: Runtime>(app: &AppHandle<R>, db: &Db, vault: &Vault) -> Result<LiveKitServer> {
    let theirs = vault.livekit(app)?.is_some();
    settings::livekit_server(&db.conn(), theirs)
}

/// The user's own keys, or what to do without them.
fn their_keys<R: Runtime>(app: &AppHandle<R>, vault: &Vault) -> Result<LiveKitKeys> {
    vault
        .livekit(app)?
        .ok_or_else(|| Error::Invalid("Add your LiveKit keys in Settings first.".into()))
}

/// The server a new call opens on, started if it's this Mac's.
pub fn for_new_call<R: Runtime>(
    app: &AppHandle<R>,
    db: &Db,
    vault: &Vault,
    local: &LocalServer,
) -> Result<LiveKitKeys> {
    match chosen(app, db, vault)? {
        LiveKitServer::ThisMac => local.ensure(),
        LiveKitServer::Theirs => {
            // The last call has ended (one call at a time), so nothing is on this Mac's.
            local.stop();
            their_keys(app, vault)
        }
    }
}

/// The server a call that isn't this run's own would join (`calls::call_token`), without
/// starting anything: a token only reads.
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

/// The LiveKit server calls use.
#[tauri::command(async)]
pub fn livekit_server<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    vault: State<'_, Vault>,
) -> Result<LiveKitServer> {
    chosen(&app, &db, &vault)
}

/// Chooses the LiveKit server calls use, from the next call on. Every window re-reads what a
/// call needs (`keys-changed`): this Mac's needs no keys.
#[tauri::command(async)]
pub fn set_livekit_server<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    server: LiveKitServer,
) -> Result<()> {
    settings::save_livekit_server(&db.conn(), server)?;
    let _ = app.emit(KEYS_CHANGED, ());
    Ok(())
}
