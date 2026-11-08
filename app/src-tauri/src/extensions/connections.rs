//! The hosted MCP extensions' sign-ins (docs/decisions/hosted-mcp-extensions-with-oauth.md):
//! Connect and Disconnect in Settings, Extensions (`connect_extension`,
//! `cancel_extension_connect`, `disconnect_extension`), the fresh access tokens the worker
//! asks for over the token socket (`fresh_token`, `tokens.rs`), and opening the sign-in
//! links their tools hand back (`open_extension_link`). The grants live in the keychain
//! (`credentials::Vault`); the flow itself is `oauth.rs`.

use std::collections::BTreeSet;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;
use url::Url;

use super::oauth::{self, OAuthError};
use super::{CHANGED, ConnectSpec, ExtensionSetting};
use crate::credentials::Vault;
use crate::db::{Db, now_ms};
use crate::error::{Error, Result};
use crate::sync;

const CANCELLED: &str = "The sign-in was cancelled.";

/// The sign-in under way, if any, and the lock that keeps refreshes one at a time (a
/// rotating refresh token works once). Tauri state.
#[derive(Default)]
pub struct Connections {
    connecting: Mutex<Option<oneshot::Sender<()>>>,
    refreshing: tokio::sync::Mutex<()>,
}

fn spec(id: &str) -> Result<&'static ConnectSpec> {
    super::connect_spec(id)
        .ok_or_else(|| Error::Invalid(format!("Bomby has no extension called {id} to connect.")))
}

fn changed<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<ExtensionSetting>> {
    let _ = app.emit(CHANGED, ());
    let db = app.state::<Db>();
    let vault = app.state::<Vault>();
    super::settings(&db.conn(), &vault.grants(app)?)
}

/// The extensions that are signed in, by id.
pub(crate) fn connected<R: Runtime>(app: &AppHandle<R>, vault: &Vault) -> Result<BTreeSet<String>> {
    Ok(vault.grants(app)?.into_keys().collect())
}

/// Signs in to the extension's vendor in the browser and keeps the grant. Waits until the
/// user finishes, cancels (`cancel_extension_connect`) or takes too long. A sign-in already
/// under way is cancelled.
#[tauri::command]
pub async fn connect_extension<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<Vec<ExtensionSetting>> {
    let spec = spec(&id)?;
    let (cancel, cancelled) = oneshot::channel();
    if let Some(earlier) = sync::lock(&app.state::<Connections>().connecting).replace(cancel) {
        let _ = earlier.send(());
    }
    let http = oauth::client().map_err(|e| Error::Invalid(e.to_string()))?;
    let opener = app.clone();
    let open = move |url: &str| {
        opener
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|e| OAuthError::Failed(format!("Couldn't open your browser: {e}")))
    };
    let outcome = tokio::select! {
        signed_in = oauth::sign_in(&http, &spec.mcp_url, open, now_ms) => Some(signed_in),
        _ = cancelled => None,
    };
    let grant = match outcome {
        None => return Err(Error::Invalid(CANCELLED.into())),
        Some(Err(e)) => return Err(Error::Invalid(e.to_string())),
        Some(Ok(grant)) => grant,
    };
    app.state::<Vault>().set_grant(&app, &id, Some(grant))?;
    changed(&app)
}

/// Stops the sign-in under way; it fails with "cancelled", which the page doesn't show.
#[tauri::command(async)]
pub fn cancel_extension_connect<R: Runtime>(app: AppHandle<R>) {
    if let Some(cancel) = sync::lock(&app.state::<Connections>().connecting).take() {
        let _ = cancel.send(());
    }
}

/// Forgets the sign-in; calls stop getting the extension until it's connected again.
#[tauri::command(async)]
pub fn disconnect_extension<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<Vec<ExtensionSetting>> {
    let _ = spec(&id)?;
    app.state::<Vault>().set_grant(&app, &id, None)?;
    changed(&app)
}

/// An access token for the worker: the saved one, unless it's `stale` (the one the worker
/// has, turned away or about to expire) or expiring, in which case it's refreshed first. The
/// error is a line for the voice model.
pub async fn fresh_token<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    stale: Option<&str>,
) -> std::result::Result<(String, Option<i64>), String> {
    let name = super::name(id).ok_or_else(|| format!("Bomby has no extension called {id}."))?;
    if super::connect_spec(id).is_none() {
        return Err(format!("{name} doesn't sign in."));
    }
    let not_connected =
        || format!("{name} isn't connected. The user can connect it in Settings, Extensions.");
    let connections = app.state::<Connections>();
    let vault = app.state::<Vault>();
    // One refresh at a time: a second caller waits, then finds the newer token.
    let _refreshing = connections.refreshing.lock().await;
    let grants = vault.grants(app).map_err(|e| e.to_string())?;
    let grant = grants.get(id).ok_or_else(not_connected)?;
    let now = now_ms();
    if Some(grant.access_token.as_str()) != stale && !grant.expiring(now) {
        return Ok((grant.access_token.clone(), grant.expires_in(now)));
    }
    let http = oauth::client().map_err(|e| e.to_string())?;
    match oauth::refresh(&http, grant, now).await {
        Ok(fresh) => {
            let answer = (fresh.access_token.clone(), fresh.expires_in(now));
            vault
                .set_grant(app, id, Some(fresh))
                .map_err(|e| e.to_string())?;
            Ok(answer)
        }
        Err(OAuthError::SignInAgain(_)) => {
            let _ = vault.set_grant(app, id, None);
            let _ = app.emit(CHANGED, ());
            Err(format!(
                "{name}'s sign-in expired. The user can connect it again in Settings, Extensions."
            ))
        }
        Err(OAuthError::Failed(message)) => Err(message),
    }
}

/// Whether `url` is https on one of `hosts` or a subdomain of one (`allowed` in
/// `agent/extensions/hosted_mcp.py`).
pub fn allowed(url: &str, hosts: &[String]) -> bool {
    let Ok(url) = Url::parse(url) else {
        return false;
    };
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    url.scheme() == "https"
        && hosts
            .iter()
            .any(|h| host == *h || host.ends_with(&format!(".{h}")))
}

/// Opens a link an extension's tool handed back (a page to sign in to an app) in the
/// browser, only on that vendor's hosts. Bomby asks for it over RPC (`<id>.open_link`).
#[tauri::command(async)]
pub fn open_extension_link<R: Runtime>(app: AppHandle<R>, id: String, url: String) -> Result<()> {
    let spec = spec(&id)?;
    if !allowed(&url, &spec.link_hosts) {
        return Err(Error::Invalid(format!(
            "That isn't a {} link, so it wasn't opened.",
            super::name(&id).unwrap_or(&id)
        )));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| Error::Invalid(format!("Couldn't open the browser: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_open_only_on_the_vendors_hosts_over_https() {
        let hosts = vec!["composio.dev".to_owned()];
        assert!(allowed("https://connect.composio.dev/link/lk_1", &hosts));
        assert!(allowed("https://composio.dev/", &hosts));
        assert!(!allowed("http://connect.composio.dev/link", &hosts));
        assert!(!allowed("https://composio.dev.evil.example/", &hosts));
        assert!(!allowed("https://evilcomposio.dev/", &hosts));
        assert!(!allowed("file:///etc/passwd", &hosts));
        assert!(!allowed("not a url", &hosts));
    }
}
