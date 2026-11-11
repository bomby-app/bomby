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
//!
//! A coding agent's keys are here too, by agent id and environment variable, saved in
//! Settings, Agents: each reaches only that agent, in its environment
//! (docs/decisions/agent-keys-through-the-environment.md). Bomby sends them nowhere else.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::blocking::blocking;
use crate::error::{Error, Result};
use crate::extensions::oauth::{Expect, Grant};
use crate::sync::{self, Exclusive};
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
    /// The coding agents' keys, by agent id, then by the environment variable the agent
    /// reads it from: `{"goose": {"OPENROUTER_API_KEY": "..."}}`.
    #[serde(default)]
    agent_keys: BTreeMap<String, BTreeMap<String, String>>,
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
        .chain(
            self.agent_keys
                .values()
                .flat_map(|keys| keys.values().map(String::as_str)),
        )
    }

    fn is_empty(&self) -> bool {
        self.livekit.is_none()
            && self.gemini_key.is_none()
            && self.openai_key.is_none()
            && self.rime_key.is_none()
            && self.zep_key.is_none()
            && self.grants.is_empty()
            && self.agent_keys.is_empty()
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
    let entry = entry(app, ACCOUNT)?;
    if keys.is_empty() {
        return remove(&entry);
    }
    entry.set_password(&serde_json::to_string(keys).map_err(Error::Corrupt)?)?;
    Ok(())
}

/// Reads the entry; no keys yet when there is none.
fn read_keychain<R: Runtime>(app: &AppHandle<R>) -> Result<Keys> {
    match read(&entry(app, ACCOUNT)?)? {
        Some(json) => serde_json::from_str(&json).map_err(Error::Corrupt),
        None => Ok(Keys::default()),
    }
}

/// Where the vault keeps the keys.
#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum Store {
    /// The keychain entry.
    #[default]
    Keychain,
    /// Memory only: the keys start empty and last for the run, and the keychain is never read
    /// or written (`just app dev --no-keys`, the launch smoke check, tests).
    Memory,
}

/// What the vault knows of the saved keys.
enum Cache {
    /// Nothing read yet.
    Unread,
    Read(Keys),
    /// The read failed (denied, say), and why: not asked again, so not prompted again, until
    /// the user acts (a save, or Try again: [`Vault::read_again`]).
    Unreadable(String),
}

/// The keychain entry, read on first use and kept for the run, and every secret the vault
/// has held this run. Tauri state.
///
/// No lock is held across a keychain call but `keychain`, which only the first read and each
/// change take: a password prompt the user hasn't answered holds up nothing that already has
/// the keys. Both locks are [`Exclusive`]: a thread can't take one twice.
pub struct Vault {
    store: Store,
    /// Held only to look or swap.
    cache: Exclusive<Cache>,
    /// Held across every keychain read and write, so first reads at the same time share one
    /// prompt and two changes never interleave. Taken before `cache`.
    keychain: Exclusive<()>,
    /// The first successful read after a failed one, not yet acted on: the agents are checked
    /// again with their keys ([`Vault::take_recovered`]).
    recovered: AtomicBool,
    /// Every key, secret and token read from the keychain or saved this run, kept after it's
    /// replaced, cleared or disconnected: the logs may still hold it, so Export Diagnostics
    /// takes them all out (`diagnostics`). Private: only `secrets_this_run` reads it. A leaf:
    /// nothing is locked while it's held.
    seen: Mutex<BTreeSet<String>>,
}

impl Default for Vault {
    fn default() -> Self {
        Self {
            store: Store::Keychain,
            cache: Exclusive::new("the keys", Cache::Unread),
            keychain: Exclusive::new("the keychain", ()),
            recovered: AtomicBool::new(false),
            seen: Mutex::default(),
        }
    }
}

impl Vault {
    /// A vault that never touches the keychain ([`Store::Memory`]).
    pub fn in_memory() -> Self {
        Self {
            store: Store::Memory,
            ..Self::default()
        }
    }

    /// Saves LiveKit keys, for other modules' tests.
    #[cfg(test)]
    pub(crate) fn save_livekit_for_tests(&self, livekit: LiveKitKeys) {
        self.change_with(
            || Ok(Keys::default()),
            |keys| {
                keys.livekit = Some(livekit);
                Ok(())
            },
            |_| Ok(()),
        )
        .unwrap();
    }

    /// The saved keys, from the store.
    fn fetch<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Keys> {
        match self.store {
            Store::Keychain => read_keychain(app),
            Store::Memory => Ok(Keys::default()),
        }
    }

    /// Saves `keys` in the store; in memory, the cache is all there is.
    fn save<R: Runtime>(&self, app: &AppHandle<R>, keys: &Keys) -> Result<()> {
        match self.store {
            Store::Keychain => write(app, keys),
            Store::Memory => Ok(()),
        }
    }

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

    /// The keys, if read; the failure when the read failed, unless `retry`.
    fn cached(&self, retry: bool) -> Result<Option<Keys>> {
        match &*self.cache.lock()? {
            Cache::Read(keys) => Ok(Some(keys.clone())),
            Cache::Unreadable(why) if !retry => Err(Error::Unreadable(why.clone())),
            Cache::Unreadable(_) | Cache::Unread => Ok(None),
        }
    }

    /// The keys, read with `fetch` (the keychain) the first time, and again when the last
    /// read failed and this one may `retry`. The caller holds `keychain`.
    fn load(&self, fetch: impl FnOnce() -> Result<Keys>, retry: bool) -> Result<Keys> {
        // Another thread may have read them while this one waited for the keychain.
        if let Some(keys) = self.cached(retry)? {
            return Ok(keys);
        }
        let fetched = fetch();
        let mut cache = self.cache.lock()?;
        match fetched {
            Ok(keys) => {
                self.remember(keys.secrets());
                if matches!(*cache, Cache::Unreadable(_)) {
                    self.recovered.store(true, Ordering::SeqCst);
                }
                *cache = Cache::Read(keys.clone());
                Ok(keys)
            }
            Err(e) => {
                *cache = Cache::Unreadable(e.to_string());
                Err(Error::Unreadable(e.to_string()))
            }
        }
    }

    /// Reads part of the keys, without copying the rest.
    fn read<R: Runtime, T>(&self, app: &AppHandle<R>, take: impl FnOnce(&Keys) -> T) -> Result<T> {
        self.read_with(|| self.fetch(app), take)
    }

    fn read_with<T>(
        &self,
        fetch: impl FnOnce() -> Result<Keys>,
        take: impl FnOnce(&Keys) -> T,
    ) -> Result<T> {
        if let Some(keys) = self.cached(false)? {
            return Ok(take(&keys));
        }
        let _keychain = self.keychain.lock()?;
        Ok(take(&self.load(fetch, false)?))
    }

    /// Whether the saved keys couldn't be read this run (and haven't been since). A check
    /// made meanwhile ran without the agents' keys, so it isn't remembered.
    pub fn unreadable(&self) -> bool {
        self.cache
            .lock()
            .is_ok_and(|cache| matches!(*cache, Cache::Unreadable(_)))
    }

    /// Reads the keys again after a failed read (Try again); an error when it fails again.
    pub fn read_again<R: Runtime>(&self, app: &AppHandle<R>) -> Result<()> {
        let _keychain = self.keychain.lock()?;
        self.load(|| self.fetch(app), true).map(drop)
    }

    /// Whether the keys were just read after a failed read, once: the agents were checked
    /// without them and are checked again.
    fn take_recovered(&self) -> bool {
        self.recovered.swap(false, Ordering::SeqCst)
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
        self.check_agents_if_recovered(app);
        Ok(())
    }

    /// After the keys were read following a failed read: the looks since ran without the
    /// agents' keys, so the agents are checked again, in the background.
    fn check_agents_if_recovered<R: Runtime>(&self, app: &AppHandle<R>) {
        if self.take_recovered() {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                crate::agents::refresh_after_change(&app);
            });
        }
    }

    /// Changes the keys and writes them back, under one lock.
    fn write_back<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        change: impl FnOnce(&mut Keys) -> Result<()>,
    ) -> Result<()> {
        self.change_with(|| self.fetch(app), change, |keys| self.save(app, keys))
    }

    /// `write_back` with the keychain's read and write passed in. What the change put in is
    /// remembered for redaction even when saving it fails: it was in memory, and may have
    /// been handed on. A change is the user acting, so a read that failed is tried again.
    fn change_with(
        &self,
        fetch: impl FnOnce() -> Result<Keys>,
        change: impl FnOnce(&mut Keys) -> Result<()>,
        save: impl FnOnce(&Keys) -> Result<()>,
    ) -> Result<()> {
        let _keychain = self.keychain.lock()?;
        let mut keys = self.load(fetch, true)?;
        let before = keys.clone();
        let changed = change(&mut keys);
        self.remember(keys.secrets());
        changed?;
        // Nothing changed, nothing to write (a refresh that lost a race, say).
        if keys != before {
            // Written before it's kept: a failed save leaves the keys as they were.
            save(&keys)?;
            *self.cache.lock()? = Cache::Read(keys);
        }
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

    /// Every coding agent's saved keys, by agent id and variable, for their environment
    /// (`agent_keys_env`).
    pub fn agent_keys<R: Runtime>(&self, app: &AppHandle<R>) -> Result<AgentKeys> {
        self.read(app, |keys| keys.agent_keys.clone())
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

/// The coding agents' saved keys: by agent id, then by environment variable.
pub type AgentKeys = BTreeMap<String, BTreeMap<String, String>>;

/// Where the voice agent reads the coding agents' keys from (`AGENT_KEYS_ENV` in
/// `agent/acp_client/environment.py`), which hands each agent only its own.
pub const AGENT_KEYS_ENV: &str = "BOMBY_AGENT_KEYS";

/// `keys` as the voice agent reads them from [`AGENT_KEYS_ENV`], or `None` when none is
/// saved. Only ever an environment variable of the worker or the probe: never an argument
/// (the process list shows those) and never in a call's metadata.
pub fn agent_keys_env(keys: &AgentKeys) -> Option<String> {
    let saved: BTreeMap<_, _> = keys.iter().filter(|(_, vars)| !vars.is_empty()).collect();
    (!saved.is_empty()).then(|| serde_json::json!(saved).to_string())
}

/// The variables with a saved key, by agent id, for the page: names only, never a key.
pub fn agent_key_names(keys: &AgentKeys) -> BTreeMap<String, Vec<String>> {
    keys.iter()
        .filter(|(_, vars)| !vars.is_empty())
        .map(|(agent, vars)| (agent.clone(), vars.keys().cloned().collect()))
        .collect()
}

/// Whether `name` may hold a coding agent's key: an environment variable's name in capitals
/// (`OPENROUTER_API_KEY`), and none that runs the agent's process or belongs to Bomby
/// (`PATH`, `DYLD_...`, `BOMBY_...`, `LIVEKIT_...`). The command also checks the agent asks
/// for it.
fn agent_key_name_allowed(name: &str) -> bool {
    const RESERVED: &[&str] = &["PATH", "HOME", "SHELL", "USER", "TMPDIR", "PWD"];
    const RESERVED_PREFIXES: &[&str] = &["BOMBY_", "LIVEKIT_", "DYLD_", "LD_"];
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_uppercase())
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && name.len() <= 64
        && !RESERVED.contains(&name)
        && !RESERVED_PREFIXES.iter().any(|p| name.starts_with(p))
}

/// Whether a key may be saved for an agent under `name`: an allowed variable that the
/// agent asks for (`offered`), or one already saved for it (`saved`), shown on its row so it
/// can be replaced (another provider's).
fn may_save_agent_key(name: &str, offered: bool, saved: bool) -> bool {
    agent_key_name_allowed(name) && (offered || saved)
}

/// Reads the keys from the keychain again after a read that failed this run (denied at the
/// prompt, say): Try again on the error. Every window then reads which keys are saved, and
/// the agents are checked again with theirs.
#[tauri::command]
pub async fn read_keys_again<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        vault.read_again(app)?;
        let _ = app.emit(KEYS_CHANGED, ());
        vault.check_agents_if_recovered(app);
        Ok(())
    })
    .await
}

/// The saved LiveKit keys without the secret, or `None` when nothing is saved.
#[tauri::command]
pub async fn credentials_info<R: Runtime>(app: AppHandle<R>) -> Result<Option<CredentialsInfo>> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        Ok(vault.livekit(app)?.map(|s| CredentialsInfo {
            url: s.url,
            api_key: s.api_key,
            has_secret: !s.api_secret.is_empty(),
        }))
    })
    .await
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

#[tauri::command]
pub async fn save_credentials<R: Runtime>(
    app: AppHandle<R>,
    input: CredentialsInput,
) -> Result<()> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        vault.update(app, |keys| {
            keys.livekit = Some(merge(input, keys.livekit.take())?);
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn clear_credentials<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        vault.update(app, |keys| {
            keys.livekit = None;
            Ok(())
        })
    })
    .await
}

/// Saves a voice provider's key; whether one is saved comes with `voice::voice_settings`.
/// The key itself stays in the core.
#[tauri::command]
pub async fn save_voice_key<R: Runtime>(
    app: AppHandle<R>,
    provider: VoiceProvider,
    key: String,
) -> Result<()> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        let key = key.trim();
        if key.is_empty() || key.contains(char::is_whitespace) {
            return Err(Error::Invalid(format!(
                "Paste the whole {} API key.",
                provider.name()
            )));
        }
        vault.update(app, |keys| {
            *keys.voice_key(provider) = Some(key.to_owned());
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn clear_voice_key<R: Runtime>(app: AppHandle<R>, provider: VoiceProvider) -> Result<()> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        vault.update(app, |keys| {
            *keys.voice_key(provider) = None;
            Ok(())
        })
    })
    .await
}

/// Whether a Zep key is saved. The key itself stays in the core.
#[tauri::command]
pub async fn has_zep_key<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        Ok(vault.zep_key(app)?.is_some())
    })
    .await
}

#[tauri::command]
pub async fn save_zep_key<R: Runtime>(app: AppHandle<R>, key: String) -> Result<()> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        let key = key.trim();
        if key.is_empty() || key.contains(char::is_whitespace) {
            return Err(Error::Invalid("Paste the whole Zep API key.".into()));
        }
        vault.update(app, |keys| {
            keys.zep_key = Some(key.to_owned());
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn clear_zep_key<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        vault.update(app, |keys| {
            keys.zep_key = None;
            Ok(())
        })
    })
    .await
}

/// Which variables have a key saved, by agent id: names only, never a key.
#[tauri::command]
pub async fn agent_keys<R: Runtime>(app: AppHandle<R>) -> Result<BTreeMap<String, Vec<String>>> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        Ok(agent_key_names(&vault.agent_keys(app)?))
    })
    .await
}

/// Saves a coding agent's key under the variable `name`: one the agent asks for (its row's
/// key fields, from the probe), or one already saved for it, which this replaces. It reaches
/// only that agent, from its next start; the agent is checked again with it.
#[tauri::command]
pub async fn save_agent_key<R: Runtime>(
    app: AppHandle<R>,
    agent: String,
    name: String,
    key: String,
) -> Result<()> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        let key = key.trim();
        if key.is_empty() || key.contains(char::is_whitespace) {
            return Err(Error::Invalid("Paste the whole key.".into()));
        }
        let offered = crate::agents::offers_key(app, &agent, &name);
        vault.update(app, |keys| {
            let saved = keys.agent_keys.entry(agent.clone()).or_default();
            if !may_save_agent_key(&name, offered, saved.contains_key(&name)) {
                return Err(Error::Invalid(format!(
                    "{} doesn't ask for {name}.",
                    crate::agents::name(&agent).unwrap_or("This agent")
                )));
            }
            saved.insert(name, key.to_owned());
            Ok(())
        })?;
        crate::agents::keys_changed(app, &agent);
        Ok(())
    })
    .await
}

/// Removes a coding agent's saved key: the agent goes back to finding its own.
#[tauri::command]
pub async fn clear_agent_key<R: Runtime>(
    app: AppHandle<R>,
    agent: String,
    name: String,
) -> Result<()> {
    blocking(app, move |app| {
        let vault = app.state::<Vault>();
        vault.update(app, |keys| {
            if let Some(vars) = keys.agent_keys.get_mut(&agent) {
                vars.remove(&name);
                if vars.is_empty() {
                    keys.agent_keys.remove(&agent);
                }
            }
            Ok(())
        })?;
        crate::agents::keys_changed(app, &agent);
        Ok(())
    })
    .await
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
    fn a_failed_read_isnt_asked_again_until_the_user_acts() {
        let vault = Vault::default();
        let denied = || Err(Error::Invalid("User canceled the operation.".into()));
        assert!(matches!(
            vault.read_with(denied, |_| ()),
            Err(Error::Unreadable(_))
        ));
        assert!(vault.unreadable());
        // Every later read answers at once, without asking (and prompting) again.
        assert!(matches!(
            vault.read_with(|| unreachable!("not asked again"), |_| ()),
            Err(Error::Unreadable(_))
        ));
        // A save is the user acting: asked again, and kept once read.
        let keys = Keys {
            zep_key: Some("zep-1".into()),
            ..Keys::default()
        };
        vault
            .change_with(
                || Ok(keys.clone()),
                |keys| {
                    keys.gemini_key = Some("gemini-1".into());
                    Ok(())
                },
                |_| Ok(()),
            )
            .unwrap();
        assert!(!vault.unreadable());
        assert!(vault.take_recovered(), "the agents are checked again");
        assert!(!vault.take_recovered(), "once");
        assert_eq!(
            vault
                .read_with(
                    || unreachable!(),
                    |k| (k.zep_key.clone(), k.gemini_key.clone())
                )
                .unwrap(),
            (Some("zep-1".into()), Some("gemini-1".into()))
        );
    }

    #[test]
    fn no_lock_but_the_keychains_is_held_while_the_keychain_answers() {
        let vault = Vault::default();
        vault
            .read_with(
                || {
                    assert!(vault.keychain.held_here());
                    assert!(!vault.cache.held_here(), "readers aren't held up");
                    Ok(Keys::default())
                },
                |_| (),
            )
            .unwrap();
        vault
            .change_with(
                || unreachable!("already read"),
                |keys| {
                    keys.zep_key = Some("zep".into());
                    Ok(())
                },
                |_| {
                    assert!(!vault.cache.held_here());
                    Ok(())
                },
            )
            .unwrap();
        // Read while a change runs (a change that reads, say): from the cache, no wait.
        vault
            .change_with(
                || unreachable!(),
                |_| {
                    assert_eq!(
                        vault
                            .read_with(|| unreachable!(), |k| k.zep_key.clone())
                            .unwrap(),
                        Some("zep".into())
                    );
                    Ok(())
                },
                |_| Ok(()),
            )
            .unwrap();
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
    fn agent_keys_are_redacted_and_go_to_the_agent_only_as_its_variables() {
        let vault = Vault::default();
        let keys = Keys {
            agent_keys: BTreeMap::from([(
                "goose".into(),
                BTreeMap::from([("OPENROUTER_API_KEY".into(), "sk-or-1".into())]),
            )]),
            ..Keys::default()
        };
        assert!(!keys.is_empty());
        let saved = vault
            .read_with(|| Ok(keys), |k| k.agent_keys.clone())
            .unwrap();
        assert_eq!(vault.secrets_this_run(), ["sk-or-1"]);
        assert_eq!(
            agent_keys_env(&saved).as_deref(),
            Some(r#"{"goose":{"OPENROUTER_API_KEY":"sk-or-1"}}"#)
        );
        assert_eq!(
            agent_key_names(&saved),
            BTreeMap::from([("goose".into(), vec!["OPENROUTER_API_KEY".into()])])
        );
        assert_eq!(agent_keys_env(&AgentKeys::default()), None);
        let emptied = BTreeMap::from([("goose".into(), BTreeMap::new())]);
        assert_eq!(
            agent_keys_env(&emptied),
            None,
            "an agent with none sends nothing"
        );
    }

    #[test]
    fn an_agent_key_is_a_variable_that_runs_nothing_and_isnt_bombys() {
        for name in [
            "OPENROUTER_API_KEY",
            "OPENAI_API_KEY",
            "XAI_API_KEY",
            "A1_B",
        ] {
            assert!(agent_key_name_allowed(name), "{name}");
        }
        for name in [
            "",
            "openai_api_key",
            "1KEY",
            "KEY-X",
            "KEY X",
            "PATH",
            "HOME",
            "DYLD_INSERT_LIBRARIES",
            "LD_PRELOAD",
            "BOMBY_AGENT_KEYS",
            "LIVEKIT_API_SECRET",
            &"K".repeat(65),
        ] {
            assert!(!agent_key_name_allowed(name), "{name}");
        }
    }

    #[test]
    fn a_saved_key_the_agent_no_longer_asks_for_can_still_be_replaced() {
        assert!(
            may_save_agent_key("OPENROUTER_API_KEY", true, false),
            "asked for"
        );
        assert!(
            may_save_agent_key("ANTHROPIC_API_KEY", false, true),
            "saved under another provider: its row offers Replace"
        );
        assert!(!may_save_agent_key("ANTHROPIC_API_KEY", false, false));
        assert!(
            !may_save_agent_key("BOMBY_AGENT_KEYS", true, true),
            "never one of Bomby's own, whatever the row says"
        );
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
