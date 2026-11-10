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

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::dev;
use crate::error::{Error, Result};
use crate::extensions::oauth::{Expect, Grant};
use crate::sync;
use crate::voice::VoiceProvider;

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
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Keys {
    livekit: Option<LiveKitKeys>,
    gemini_key: Option<String>,
    #[serde(default)]
    openai_key: Option<String>,
    #[serde(default)]
    rime_key: Option<String>,
    /// For memory across conversations (`settings::Memory::Zep`).
    #[serde(default)]
    zep_key: Option<String>,
    /// The hosted MCP extensions' sign-ins, by extension id (`extensions/connections.rs`).
    #[serde(default)]
    grants: BTreeMap<String, Grant>,
}

impl Keys {
    fn voice_key(&mut self, provider: VoiceProvider) -> &mut Option<String> {
        match provider {
            VoiceProvider::Gemini => &mut self.gemini_key,
            VoiceProvider::OpenAi => &mut self.openai_key,
            VoiceProvider::Rime => &mut self.rime_key,
        }
    }

    /// Every key, secret and token in it, for the vault's redaction history.
    fn secrets(&self) -> impl Iterator<Item = &str> {
        [
            self.livekit.as_ref().map(|k| k.api_secret.as_str()),
            self.gemini_key.as_deref(),
            self.openai_key.as_deref(),
            self.rime_key.as_deref(),
            self.zep_key.as_deref(),
        ]
        .into_iter()
        .flatten()
        .chain(self.grants.values().flat_map(Grant::secrets))
    }

    fn is_empty(&self) -> bool {
        self.livekit.is_none()
            && self.gemini_key.is_none()
            && self.openai_key.is_none()
            && self.rime_key.is_none()
            && self.zep_key.is_none()
            && self.grants.is_empty()
    }
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
    if keys.is_empty() {
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

/// The keychain entry, read on first use and kept for the run, and every secret the vault
/// has held this run. Tauri state.
#[derive(Default)]
pub struct Vault {
    keys: Mutex<Option<Keys>>,
    /// Every key, secret and token read from the keychain or saved this run, kept after it's
    /// replaced, cleared or disconnected: the logs may still hold it, so Export Diagnostics
    /// takes them all out (`diagnostics`). Private: only `secrets_this_run` reads it. Locked
    /// after `keys` when both are.
    seen: Mutex<BTreeSet<String>>,
}

impl Vault {
    fn keys<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Keys> {
        self.read(app, Keys::clone)
    }

    /// Adds these secrets to the redaction history.
    fn remember<'a>(&self, secrets: impl IntoIterator<Item = &'a str>) {
        let mut seen = sync::lock(&self.seen);
        for secret in secrets {
            if !seen.contains(secret) {
                seen.insert(secret.to_owned());
            }
        }
    }

    /// The cached keys, or `fetch`'s (the keychain's) the first time, remembered for redaction.
    fn load(
        &self,
        cached: &mut Option<Keys>,
        fetch: impl FnOnce() -> Result<Keys>,
    ) -> Result<Keys> {
        if let Some(keys) = cached.take() {
            return Ok(keys);
        }
        let keys = fetch()?;
        self.remember(keys.secrets());
        Ok(keys)
    }

    /// Reads part of the keys under the lock, without copying the rest.
    fn read<R: Runtime, T>(&self, app: &AppHandle<R>, take: impl FnOnce(&Keys) -> T) -> Result<T> {
        self.read_with(|| read_keychain(app), take)
    }

    fn read_with<T>(
        &self,
        fetch: impl FnOnce() -> Result<Keys>,
        take: impl FnOnce(&Keys) -> T,
    ) -> Result<T> {
        let mut cached = sync::lock(&self.keys);
        let keys = self.load(&mut cached, fetch)?;
        Ok(take(cached.insert(keys)))
    }

    /// Changes the keys and writes them back, under one lock, and tells every window.
    fn update<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        change: impl FnOnce(&mut Keys) -> Result<()>,
    ) -> Result<()> {
        self.write_back(app, change)?;
        // Every window re-reads which keys are saved (no key goes with it). Only fails for
        // an invalid event name or payload.
        let _ = app.emit(KEYS_CHANGED, ());
        Ok(())
    }

    /// Changes the keys and writes them back, under one lock.
    fn write_back<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        change: impl FnOnce(&mut Keys) -> Result<()>,
    ) -> Result<()> {
        self.change_with(|| read_keychain(app), change, |keys| write(app, keys))
    }

    /// `write_back` with the keychain's read and write passed in. What the change put in is
    /// remembered for redaction even when saving it fails: it was in memory, and may have
    /// been handed on.
    fn change_with(
        &self,
        fetch: impl FnOnce() -> Result<Keys>,
        change: impl FnOnce(&mut Keys) -> Result<()>,
        save: impl FnOnce(&Keys) -> Result<()>,
    ) -> Result<()> {
        let mut cached = sync::lock(&self.keys);
        let mut keys = self.load(&mut cached, fetch)?;
        let before = keys.clone();
        let changed = change(&mut keys);
        self.remember(keys.secrets());
        if let Err(e) = changed.and_then(|()| {
            // Nothing changed, nothing to write (a refresh that lost a race, say).
            if keys == before { Ok(()) } else { save(&keys) }
        }) {
            *cached = Some(before);
            return Err(e);
        }
        *cached = Some(keys);
        Ok(())
    }

    /// Every key, secret and token the vault has held this run, sorted and without
    /// repeats, current or since replaced, cleared or disconnected, so Export Diagnostics
    /// can take them out of the logs (`diagnostics`). Never reads the keychain itself: a
    /// secret never read this run was never handed to anything that logs this run.
    pub fn secrets_this_run(&self) -> Vec<String> {
        sync::lock(&self.seen).iter().cloned().collect()
    }

    pub fn livekit<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Option<LiveKitKeys>> {
        Ok(self.keys(app)?.livekit)
    }

    /// Every voice provider's key that's saved. The worker gets them all, so picking
    /// another provider doesn't restart it.
    pub fn voice_keys<R: Runtime>(
        &self,
        app: &AppHandle<R>,
    ) -> Result<BTreeMap<VoiceProvider, String>> {
        let mut keys = self.keys(app)?;
        Ok(VoiceProvider::ALL
            .into_iter()
            .filter_map(|p| Some((p, keys.voice_key(p).take()?)))
            .collect())
    }

    pub fn zep_key<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Option<String>> {
        Ok(self.keys(app)?.zep_key)
    }

    /// One hosted MCP extension's sign-in.
    pub fn grant<R: Runtime>(&self, app: &AppHandle<R>, id: &str) -> Result<Option<Grant>> {
        self.read(app, |keys| keys.grants.get(id).cloned())
    }

    /// Each signed-in extension's id with the account it's signed in as, no tokens.
    pub fn signed_in<R: Runtime>(
        &self,
        app: &AppHandle<R>,
    ) -> Result<BTreeMap<String, Option<String>>> {
        self.read(app, |keys| {
            keys.grants
                .iter()
                .map(|(id, grant)| (id.clone(), grant.account.clone()))
                .collect()
        })
    }

    /// Saves or removes an extension's sign-in if the saved one is still what `expect`
    /// says, under the vault's lock; false when it changed meanwhile. Quiet: the grant's
    /// own event (`extensions::CHANGED`) is the caller's to send, and a refresh mid-call
    /// sends none.
    pub fn replace_grant<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        id: &str,
        expect: Expect<'_>,
        grant: Option<Grant>,
    ) -> Result<bool> {
        // A grant that loses the race was still fetched, and may have been logged.
        self.remember(grant.iter().flat_map(Grant::secrets));
        let mut replaced = false;
        self.write_back(app, |keys| {
            if !expect.matches(keys.grants.get(id)) {
                return Ok(());
            }
            replaced = true;
            match grant {
                Some(grant) => keys.grants.insert(id.to_owned(), grant),
                None => keys.grants.remove(id),
            };
            Ok(())
        })?;
        Ok(replaced)
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

/// Saves a voice provider's key; whether one is saved comes with `voice::voice_settings`.
/// The key itself stays in the core.
#[tauri::command(async)]
pub fn save_voice_key<R: Runtime>(
    app: AppHandle<R>,
    vault: State<'_, Vault>,
    provider: VoiceProvider,
    key: String,
) -> Result<()> {
    let key = key.trim();
    if key.is_empty() || key.contains(char::is_whitespace) {
        return Err(Error::Invalid(format!(
            "Paste the whole {} API key.",
            provider.name()
        )));
    }
    vault.update(&app, |keys| {
        *keys.voice_key(provider) = Some(key.to_owned());
        Ok(())
    })
}

#[tauri::command(async)]
pub fn clear_voice_key<R: Runtime>(
    app: AppHandle<R>,
    vault: State<'_, Vault>,
    provider: VoiceProvider,
) -> Result<()> {
    vault.update(&app, |keys| {
        *keys.voice_key(provider) = None;
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

    fn grant(access: &str, refresh: Option<&str>) -> Grant {
        Grant {
            client_id: "client".into(),
            token_endpoint: "https://auth.example/token".into(),
            resource: "https://mcp.example".into(),
            access_token: access.into(),
            refresh_token: refresh.map(Into::into),
            expires_at: None,
            account: None,
        }
    }

    #[test]
    fn the_redaction_history_keeps_secrets_replaced_cleared_or_disconnected() {
        let vault = Vault::default();
        let first = Keys {
            gemini_key: Some("gemini-first".into()),
            grants: BTreeMap::from([("zapier".into(), grant("access-1", Some("refresh-1")))]),
            ..Keys::default()
        };
        assert!(vault.secrets_this_run().is_empty(), "nothing read yet");
        let saved = |_: &Keys| Ok(());
        vault.read_with(|| Ok(first.clone()), |_| ()).unwrap();
        // Replaced, then cleared; the grant refreshed, then disconnected.
        vault
            .change_with(
                || unreachable!("already read"),
                |keys| {
                    keys.gemini_key = Some("gemini-second".into());
                    keys.grants.insert("zapier".into(), grant("access-2", None));
                    Ok(())
                },
                saved,
            )
            .unwrap();
        vault
            .change_with(
                || unreachable!("already read"),
                |keys| {
                    keys.gemini_key = None;
                    keys.grants.clear();
                    Ok(())
                },
                saved,
            )
            .unwrap();
        // A key whose save failed was still in memory.
        let failed = vault.change_with(
            || unreachable!("already read"),
            |keys| {
                keys.zep_key = Some("zep-unsaved".into());
                Ok(())
            },
            |_| Err(Error::Invalid("keychain locked".into())),
        );
        assert!(failed.is_err());
        // A grant that lost a race.
        vault.remember(
            grant("access-lost", Some("refresh-lost"))
                .secrets()
                .collect::<Vec<_>>(),
        );
        assert_eq!(
            vault.secrets_this_run(),
            [
                "access-1",
                "access-2",
                "access-lost",
                "gemini-first",
                "gemini-second",
                "refresh-1",
                "refresh-lost",
                "zep-unsaved",
            ]
        );
        assert_eq!(
            vault
                .read_with(|| unreachable!(), |keys| keys.zep_key.clone())
                .unwrap(),
            None
        );
    }

    #[test]
    fn an_entry_saved_before_openai_rime_zep_and_grants_still_reads() {
        let mut keys: Keys = serde_json::from_str(r#"{"livekit":null,"gemini_key":"g"}"#).unwrap();
        assert_eq!(keys.voice_key(VoiceProvider::Gemini).as_deref(), Some("g"));
        assert_eq!(*keys.voice_key(VoiceProvider::OpenAi), None);
        assert_eq!(*keys.voice_key(VoiceProvider::Rime), None);
        assert!(!keys.is_empty());
        *keys.voice_key(VoiceProvider::Gemini) = None;
        assert!(keys.is_empty(), "nothing left, so the entry is removed");
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
