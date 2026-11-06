//! The keys the user brings (docs/decisions/users-bring-their-own-keys-and-claude.md), kept
//! in the OS secure store: Keychain on macOS, Credential Manager on Windows, Secret Service
//! on Linux.
//!
//! All of them live in one entry (service: the app identifier, account `credentials`) as
//! JSON, and the core reads it once per run and keeps it in memory (`Vault`). On macOS each
//! read of a keychain item by a binary the item doesn't trust yet asks the user, and a
//! rebuilt dev binary is never trusted yet, so one item read once means one prompt per run,
//! not one per screen.
//!
//! Secrets never go back to the page: it sees whether one is saved. The core uses them to
//! mint call tokens and passes them to the agent when it starts one.

use std::sync::Mutex;

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::dev;
use crate::error::{Error, Result};
use crate::sync;

/// Sent to every window after a key is saved or removed, with no payload.
pub const KEYS_CHANGED: &str = "keys-changed";

/// The entry's account; the service is the app identifier (tauri.conf.json).
const ACCOUNT: &str = "credentials";

/// The LiveKit keys. The core uses them for tokens and the agent's environment.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveKitKeys {
    pub url: String,
    pub api_key: String,
    pub api_secret: String,
}

/// Never prints the secret.
impl std::fmt::Debug for LiveKitKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LiveKitKeys")
            .field("url", &self.url)
            .field("api_key", &self.api_key)
            .finish_non_exhaustive()
    }
}

/// Everything in the keychain entry.
#[derive(Clone, Default, Serialize, Deserialize)]
struct Keys {
    livekit: Option<LiveKitKeys>,
    gemini_key: Option<String>,
    /// For memory across conversations (`settings::Memory::Zep`).
    #[serde(default)]
    zep_key: Option<String>,
}

/// What the page may see.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "credentials.ts"))]
pub struct CredentialsInfo {
    url: String,
    api_key: String,
    has_secret: bool,
}

/// What the page sends. No `api_secret` keeps the saved one.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "credentials.ts"))]
pub struct CredentialsInput {
    url: String,
    api_key: String,
    /// Left out to keep the saved secret.
    #[cfg_attr(test, ts(optional))]
    api_secret: Option<String>,
}

fn entry<R: Runtime>(app: &AppHandle<R>, account: &str) -> Result<Entry> {
    Ok(Entry::new(&app.config().identifier, account)?)
}

/// The entry's value, or `None` when nothing is saved.
fn read(entry: &Entry) -> Result<Option<String>> {
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn remove(entry: &Entry) -> Result<()> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn write<R: Runtime>(app: &AppHandle<R>, keys: &Keys) -> Result<()> {
    if dev::no_keys() {
        return Ok(());
    }
    let entry = entry(app, ACCOUNT)?;
    if keys.livekit.is_none() && keys.gemini_key.is_none() && keys.zep_key.is_none() {
        return remove(&entry);
    }
    entry.set_password(&serde_json::to_string(keys).map_err(Error::Corrupt)?)?;
    Ok(())
}

/// Reads the entry; no keys yet when there is none. With `just app dev --no-keys`, neither
/// this nor `write` touches the keychain: the keys start empty and last for the run
/// ([`dev`]).
fn read_keychain<R: Runtime>(app: &AppHandle<R>) -> Result<Keys> {
    if dev::no_keys() {
        return Ok(Keys::default());
    }
    match read(&entry(app, ACCOUNT)?)? {
        Some(json) => serde_json::from_str(&json).map_err(Error::Corrupt),
        None => Ok(Keys::default()),
    }
}

/// The keychain entry, read on first use and kept for the run. Tauri state.
#[derive(Default)]
pub struct Vault(Mutex<Option<Keys>>);

impl Vault {
    fn keys<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Keys> {
        let mut cached = sync::lock(&self.0);
        if cached.is_none() {
            *cached = Some(read_keychain(app)?);
        }
        Ok(cached.clone().unwrap_or_default())
    }

    /// Changes the keys and writes them back, under one lock.
    fn update<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        change: impl FnOnce(&mut Keys) -> Result<()>,
    ) -> Result<()> {
        let mut cached = sync::lock(&self.0);
        let mut keys = match cached.take() {
            Some(keys) => keys,
            None => read_keychain(app)?,
        };
        let before = keys.clone();
        if let Err(e) = change(&mut keys).and_then(|()| write(app, &keys)) {
            *cached = Some(before);
            return Err(e);
        }
        *cached = Some(keys);
        drop(cached);
        // Every window re-reads which keys are saved (no key goes with it). Only fails for
        // an invalid event name or payload.
        let _ = app.emit(KEYS_CHANGED, ());
        Ok(())
    }

    pub fn livekit<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Option<LiveKitKeys>> {
        Ok(self.keys(app)?.livekit)
    }

    pub fn gemini_key<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Option<String>> {
        Ok(self.keys(app)?.gemini_key)
    }

    pub fn zep_key<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Option<String>> {
        Ok(self.keys(app)?.zep_key)
    }
}

/// The saved LiveKit keys without the secret, or `None` when nothing is saved.
#[tauri::command(async)]
pub fn credentials_info<R: Runtime>(
    app: AppHandle<R>,
    vault: State<'_, Vault>,
) -> Result<Option<CredentialsInfo>> {
    Ok(vault.livekit(&app)?.map(|s| CredentialsInfo {
        url: s.url,
        api_key: s.api_key,
        has_secret: !s.api_secret.is_empty(),
    }))
}

/// Merges the page's input with what is saved: trims, checks, and keeps the saved secret
/// when the input has none.
fn merge(input: CredentialsInput, saved: Option<LiveKitKeys>) -> Result<LiveKitKeys> {
    let url = input.url.trim();
    let api_key = input.api_key.trim();
    let new_secret = input
        .api_secret
        .as_deref()
        .map(str::trim)
        .unwrap_or_default();

    if !(url.starts_with("wss://") || url.starts_with("ws://")) {
        return Err(Error::Invalid(
            "The server URL starts with wss:// (or ws:// for a local server).".into(),
        ));
    }
    if api_key.is_empty() {
        return Err(Error::Invalid("The API key is required.".into()));
    }
    let api_secret = match (new_secret, saved) {
        ("", Some(saved)) => saved.api_secret,
        ("", None) => return Err(Error::Invalid("The API secret is required.".into())),
        (secret, _) => secret.to_owned(),
    };

    Ok(LiveKitKeys {
        url: url.to_owned(),
        api_key: api_key.to_owned(),
        api_secret,
    })
}

#[tauri::command(async)]
pub fn save_credentials<R: Runtime>(
    app: AppHandle<R>,
    vault: State<'_, Vault>,
    input: CredentialsInput,
) -> Result<()> {
    vault.update(&app, |keys| {
        keys.livekit = Some(merge(input, keys.livekit.take())?);
        Ok(())
    })
}

#[tauri::command(async)]
pub fn clear_credentials<R: Runtime>(app: AppHandle<R>, vault: State<'_, Vault>) -> Result<()> {
    vault.update(&app, |keys| {
        keys.livekit = None;
        Ok(())
    })
}

/// Whether a Gemini key is saved. The key itself stays in the core.
#[tauri::command(async)]
pub fn has_gemini_key<R: Runtime>(app: AppHandle<R>, vault: State<'_, Vault>) -> Result<bool> {
    Ok(vault.gemini_key(&app)?.is_some())
}

#[tauri::command(async)]
pub fn save_gemini_key<R: Runtime>(
    app: AppHandle<R>,
    vault: State<'_, Vault>,
    key: String,
) -> Result<()> {
    let key = key.trim();
    if key.is_empty() || key.contains(char::is_whitespace) {
        return Err(Error::Invalid("Paste the whole Gemini API key.".into()));
    }
    vault.update(&app, |keys| {
        keys.gemini_key = Some(key.to_owned());
        Ok(())
    })
}

#[tauri::command(async)]
pub fn clear_gemini_key<R: Runtime>(app: AppHandle<R>, vault: State<'_, Vault>) -> Result<()> {
    vault.update(&app, |keys| {
        keys.gemini_key = None;
        Ok(())
    })
}

/// Whether a Zep key is saved. The key itself stays in the core.
#[tauri::command(async)]
pub fn has_zep_key<R: Runtime>(app: AppHandle<R>, vault: State<'_, Vault>) -> Result<bool> {
    Ok(vault.zep_key(&app)?.is_some())
}

#[tauri::command(async)]
pub fn save_zep_key<R: Runtime>(
    app: AppHandle<R>,
    vault: State<'_, Vault>,
    key: String,
) -> Result<()> {
    let key = key.trim();
    if key.is_empty() || key.contains(char::is_whitespace) {
        return Err(Error::Invalid("Paste the whole Zep API key.".into()));
    }
    vault.update(&app, |keys| {
        keys.zep_key = Some(key.to_owned());
        Ok(())
    })
}

#[tauri::command(async)]
pub fn clear_zep_key<R: Runtime>(app: AppHandle<R>, vault: State<'_, Vault>) -> Result<()> {
    vault.update(&app, |keys| {
        keys.zep_key = None;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(url: &str, api_key: &str, api_secret: Option<&str>) -> CredentialsInput {
        CredentialsInput {
            url: url.into(),
            api_key: api_key.into(),
            api_secret: api_secret.map(Into::into),
        }
    }

    fn saved() -> Option<LiveKitKeys> {
        Some(LiveKitKeys {
            url: "wss://old.livekit.cloud".into(),
            api_key: "OLD".into(),
            api_secret: "old-secret".into(),
        })
    }

    #[test]
    fn trims_and_saves_new_values() {
        let s = merge(
            input(" wss://a.livekit.cloud ", " KEY ", Some(" s3cret ")),
            saved(),
        )
        .unwrap();
        assert_eq!(
            (s.url.as_str(), s.api_key.as_str(), s.api_secret.as_str()),
            ("wss://a.livekit.cloud", "KEY", "s3cret")
        );
    }

    #[test]
    fn keeps_the_saved_secret_when_none_is_given() {
        for secret in [None, Some(""), Some("  ")] {
            let s = merge(input("ws://localhost:7880", "KEY", secret), saved()).unwrap();
            assert_eq!(s.api_secret, "old-secret");
        }
    }

    #[test]
    fn needs_a_secret_the_first_time() {
        assert!(matches!(
            merge(input("wss://a", "KEY", None), None),
            Err(Error::Invalid(_))
        ));
    }

    #[test]
    fn rejects_other_url_schemes_and_empty_keys() {
        assert!(matches!(
            merge(input("https://a", "KEY", Some("s")), None),
            Err(Error::Invalid(_))
        ));
        assert!(matches!(
            merge(input("wss://a", " ", Some("s")), None),
            Err(Error::Invalid(_))
        ));
    }
}
