//! Who Bomby talks through: the voice providers the agent has (`agent/voice_providers/`),
//! their voices and options, and what the user picked, kept in the database's `settings`
//! table ([decision](../../../docs/decisions/voice-providers-like-harnesses.md)). Each
//! provider's key is in the keychain (`credentials`). A pick applies from the next call.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::credentials::{KEYS_CHANGED, Vault};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::settings::{get, put};

const PROVIDER_KEY: &str = "voice_provider";
/// Picked until the user picks another, unless only another's key is saved.
const DEFAULT_PROVIDER: VoiceProvider = VoiceProvider::Gemini;

/// A speech-to-speech model a call talks through, with the user's own key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "voice.ts"))]
pub enum VoiceProvider {
    /// Gemini Live, with a Google AI Studio key.
    Gemini,
    /// Rime's Prism.
    Rime,
}

/// What Settings and the splash need of each provider before any call: its name, key
/// variable, voices and options. The agent's definitions (`agent/voice_providers/`) are
/// the one source: `just agent providers` writes them here, and `just agent check` fails
/// when this is out of date.
const CATALOGUE_JSON: &str = include_str!("../voice-providers.json");

static CATALOGUE: LazyLock<Catalogue> = LazyLock::new(|| {
    serde_json::from_str(CATALOGUE_JSON).expect("voice-providers.json is the agent's catalogue")
});

#[derive(Deserialize)]
struct Catalogue {
    providers: Vec<CatalogueEntry>,
}

/// One provider in the catalogue (`catalogue.py` in `agent/voice_providers/`).
#[derive(Deserialize)]
struct CatalogueEntry {
    id: String,
    name: String,
    key_env: String,
    default_voice: String,
    voices: Vec<Voice>,
    options: Vec<OptionDefault>,
}

#[derive(Deserialize)]
struct OptionDefault {
    id: String,
    default: bool,
}

impl VoiceProvider {
    pub const ALL: [Self; 2] = [Self::Gemini, Self::Rime];

    /// Its id in the job's metadata (`PROVIDERS` in `agent/voice_providers/`).
    pub fn id(self) -> &'static str {
        match self {
            Self::Gemini => "gemini",
            Self::Rime => "rime",
        }
    }

    fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.id() == id)
    }

    /// Its entry in the agent's catalogue; a test checks every provider has one.
    fn entry(self) -> &'static CatalogueEntry {
        CATALOGUE
            .providers
            .iter()
            .find(|entry| entry.id == self.id())
            .expect("every provider is in the agent's catalogue")
    }

    /// How the app talks about it.
    pub fn name(self) -> &'static str {
        &self.entry().name
    }

    /// Where the agent's plugin reads the key (`key_env` in `agent/voice_providers/`).
    pub fn key_env(self) -> &'static str {
        &self.entry().key_env
    }

    /// The agent defaults to the same (`default_voice`).
    fn default_voice(self) -> &'static str {
        &self.entry().default_voice
    }

    fn voices(self) -> &'static [Voice] {
        &self.entry().voices
    }

    /// Its switches and their defaults, as the agent has them (`options`).
    fn options(self) -> impl Iterator<Item = (&'static str, bool)> {
        self.entry()
            .options
            .iter()
            .map(|option| (option.id.as_str(), option.default))
    }

    /// Where its voice is saved; Gemini keeps the key every install had before.
    fn voice_setting(self) -> String {
        match self {
            Self::Gemini => "voice".to_owned(),
            Self::Rime => format!("voice_{}", self.id()),
        }
    }

    fn option_setting(self, option: &str) -> String {
        format!("voice_option.{}.{option}", self.id())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "voice.ts"))]
pub struct Voice {
    /// What the agent gets: "Kore", "aurora".
    id: String,
    name: String,
    description: String,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "voice.ts"))]
pub struct ProviderOption {
    id: &'static str,
    on: bool,
}

/// One provider as the Voice settings show it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "voice.ts"))]
pub struct ProviderSettings {
    provider: VoiceProvider,
    has_key: bool,
    /// The voice picked for it, or its default.
    voice: String,
    /// What a new install starts on.
    default_voice: &'static str,
    voices: Vec<Voice>,
    options: Vec<ProviderOption>,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "voice.ts"))]
pub struct VoiceSettings {
    /// None until the user picks one, on a new install.
    provider: Option<VoiceProvider>,
    providers: Vec<ProviderSettings>,
}

/// What a call talks through (`calls::dispatch_metadata`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CallVoice {
    pub(crate) provider: VoiceProvider,
    pub(crate) voice: String,
    pub(crate) options: BTreeMap<&'static str, bool>,
}

/// The picked provider. Until one is: the first with a saved key, so an install that had a
/// Gemini key stays on Gemini, else Gemini; saved once worked out, like the LiveKit server.
pub(crate) fn chosen(
    conn: &Connection,
    has_key: impl Fn(VoiceProvider) -> bool,
) -> Result<Option<VoiceProvider>> {
    let Some((provider, saved)) = picked(conn, has_key)? else {
        return Ok(None);
    };
    if !saved {
        save_provider(conn, provider)?;
    }
    Ok(Some(provider))
}

/// What `chosen` finds, without saving it, and whether it was saved already.
fn picked(
    conn: &Connection,
    has_key: impl Fn(VoiceProvider) -> bool,
) -> Result<Option<(VoiceProvider, bool)>> {
    if let Some(provider) = get(conn, PROVIDER_KEY)?
        .as_deref()
        .and_then(VoiceProvider::from_id)
    {
        return Ok(Some((provider, true)));
    }
    // With no key either, Gemini: the splash and Settings start with it picked (owner,
    // 2026-11-06).
    let first_with_key = VoiceProvider::ALL.into_iter().find(|&p| has_key(p));
    Ok(Some((first_with_key.unwrap_or(DEFAULT_PROVIDER), false)))
}

/// What a token for a call this run didn't open talks through: the pick as it stands,
/// read only, since fetching a token must change nothing (`calls::call_token`). The keys
/// are read before the database, which it locks once.
pub(crate) fn for_token<R: Runtime>(
    app: &AppHandle<R>,
    db: &Db,
    vault: &Vault,
) -> Result<CallVoice> {
    let keys = vault.voice_keys(app)?;
    let conn = db.conn();
    let (provider, _) = picked(&conn, |p| keys.contains_key(&p))?.ok_or_else(|| {
        Error::Invalid("Pick who Bomby talks through in Settings, Voice first.".into())
    })?;
    for_call(&conn, provider)
}

fn save_provider(conn: &Connection, provider: VoiceProvider) -> Result<()> {
    put(conn, PROVIDER_KEY, provider.id())
}

fn voice(conn: &Connection, provider: VoiceProvider) -> Result<String> {
    Ok(get(conn, &provider.voice_setting())?.unwrap_or_else(|| provider.default_voice().into()))
}

fn save_voice(conn: &Connection, provider: VoiceProvider, id: &str) -> Result<()> {
    if !provider.voices().iter().any(|v| v.id == id) {
        return Err(Error::Invalid(format!(
            "{id} isn't one of {}'s voices.",
            provider.name()
        )));
    }
    put(conn, &provider.voice_setting(), id)
}

fn options(conn: &Connection, provider: VoiceProvider) -> Result<BTreeMap<&'static str, bool>> {
    provider
        .options()
        .map(|(id, default)| {
            let on = match get(conn, &provider.option_setting(id))?.as_deref() {
                Some("1") => true,
                Some("0") => false,
                _ => default,
            };
            Ok((id, on))
        })
        .collect()
}

fn save_option(conn: &Connection, provider: VoiceProvider, option: &str, on: bool) -> Result<()> {
    if !provider.options().any(|(id, _)| id == option) {
        return Err(Error::Invalid(format!(
            "{} has no option {option}.",
            provider.name()
        )));
    }
    put(
        conn,
        &provider.option_setting(option),
        if on { "1" } else { "0" },
    )
}

pub(crate) fn for_call(conn: &Connection, provider: VoiceProvider) -> Result<CallVoice> {
    Ok(CallVoice {
        provider,
        voice: voice(conn, provider)?,
        options: options(conn, provider)?,
    })
}

/// The picked provider for a new call, with its key: what the worker needs. Fails with
/// what to add when either is missing.
pub(crate) fn for_new_call<R: Runtime>(
    app: &AppHandle<R>,
    db: &Db,
    vault: &Vault,
) -> Result<VoiceProvider> {
    let keys = vault.voice_keys(app)?;
    let provider = chosen(&db.conn(), |p| keys.contains_key(&p))?.ok_or_else(|| {
        Error::Invalid("Pick who Bomby talks through in Settings, Voice first.".into())
    })?;
    if !keys.contains_key(&provider) {
        return Err(Error::Invalid(format!(
            "Add your {} API key in Settings, Voice first.",
            provider.name()
        )));
    }
    Ok(provider)
}

#[tauri::command(async)]
pub fn voice_settings<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    vault: State<'_, Vault>,
) -> Result<VoiceSettings> {
    let keys = vault.voice_keys(&app)?;
    let conn = db.conn();
    let providers = VoiceProvider::ALL
        .into_iter()
        .map(|provider| {
            Ok(ProviderSettings {
                provider,
                has_key: keys.contains_key(&provider),
                voice: voice(&conn, provider)?,
                default_voice: provider.default_voice(),
                voices: provider.voices().to_vec(),
                options: options(&conn, provider)?
                    .into_iter()
                    .map(|(id, on)| ProviderOption { id, on })
                    .collect(),
            })
        })
        .collect::<Result<_>>()?;
    Ok(VoiceSettings {
        provider: chosen(&conn, |p| keys.contains_key(&p))?,
        providers,
    })
}

/// Applies from the next call. Every window hears keys-changed, since whether a call can
/// start depends on the provider's key.
#[tauri::command(async)]
pub fn set_voice_provider<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, Db>,
    provider: VoiceProvider,
) -> Result<()> {
    save_provider(&db.conn(), provider)?;
    let _ = app.emit(KEYS_CHANGED, ());
    Ok(())
}

/// The voice for the provider's next call; a call that's running keeps its voice.
#[tauri::command(async)]
pub fn set_voice(db: State<'_, Db>, provider: VoiceProvider, voice: String) -> Result<()> {
    save_voice(&db.conn(), provider, &voice)
}

#[tauri::command(async)]
pub fn set_voice_option(
    db: State<'_, Db>,
    provider: VoiceProvider,
    option: String,
    on: bool,
) -> Result<()> {
    save_option(&db.conn(), provider, &option, on)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn providers_are_the_agents_catalogue_in_its_order() {
        let ids: Vec<&str> = CATALOGUE.providers.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(VoiceProvider::ALL.map(VoiceProvider::id).to_vec(), ids);
        for provider in VoiceProvider::ALL {
            assert_eq!(VoiceProvider::from_id(provider.id()), Some(provider));
            assert!(
                provider
                    .voices()
                    .iter()
                    .any(|v| v.id == provider.default_voice()),
                "{provider:?}'s default is one of its voices"
            );
        }
    }

    #[test]
    fn until_picked_the_first_provider_with_a_key_else_gemini_then_the_pick() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        assert_eq!(
            chosen(&conn, |p| p == VoiceProvider::Rime).unwrap(),
            Some(VoiceProvider::Rime),
            "an install with only a Rime key starts on Rime"
        );
        // Saved once worked out: a key added later doesn't switch it.
        assert_eq!(chosen(&conn, |_| true).unwrap(), Some(VoiceProvider::Rime));

        save_provider(&conn, VoiceProvider::Gemini).unwrap();
        assert_eq!(
            chosen(&conn, |_| false).unwrap(),
            Some(VoiceProvider::Gemini)
        );

        let fresh = Db::in_memory().unwrap();
        assert_eq!(
            chosen(&fresh.conn(), |_| false).unwrap(),
            Some(VoiceProvider::Gemini),
            "a new install starts on Gemini"
        );
    }

    #[test]
    fn looking_without_choosing_saves_nothing() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let gemini = |p| p == VoiceProvider::Gemini;
        assert_eq!(
            picked(&conn, gemini).unwrap(),
            Some((VoiceProvider::Gemini, false))
        );
        assert_eq!(get(&conn, PROVIDER_KEY).unwrap(), None);
    }

    #[test]
    fn each_provider_keeps_its_own_voice() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        assert_eq!(voice(&conn, VoiceProvider::Gemini).unwrap(), "Leda");
        assert_eq!(voice(&conn, VoiceProvider::Rime).unwrap(), "aurora");

        save_voice(&conn, VoiceProvider::Gemini, "Kore").unwrap();
        save_voice(&conn, VoiceProvider::Rime, "brando").unwrap();
        assert_eq!(voice(&conn, VoiceProvider::Gemini).unwrap(), "Kore");
        assert_eq!(voice(&conn, VoiceProvider::Rime).unwrap(), "brando");
        // Gemini's stays where every install had it.
        assert_eq!(get(&conn, "voice").unwrap().as_deref(), Some("Kore"));
    }

    #[test]
    fn rejects_a_voice_the_provider_doesnt_have() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        for (provider, voice) in [
            (VoiceProvider::Gemini, "Hal"),
            (VoiceProvider::Gemini, "aurora"),
            (VoiceProvider::Rime, "Kore"),
        ] {
            assert!(matches!(
                save_voice(&conn, provider, voice),
                Err(Error::Invalid(_))
            ));
        }
    }

    #[test]
    fn google_search_is_on_until_turned_off_and_only_gemini_has_it() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        let search = |conn: &Connection| options(conn, VoiceProvider::Gemini).unwrap();
        assert_eq!(search(&conn), BTreeMap::from([("google_search", true)]));
        save_option(&conn, VoiceProvider::Gemini, "google_search", false).unwrap();
        assert_eq!(search(&conn), BTreeMap::from([("google_search", false)]));

        assert!(options(&conn, VoiceProvider::Rime).unwrap().is_empty());
        assert!(matches!(
            save_option(&conn, VoiceProvider::Rime, "google_search", true),
            Err(Error::Invalid(_))
        ));
    }

    #[test]
    fn gemini_voices_read_as_style_and_pitch() {
        let kore = VoiceProvider::Gemini
            .voices()
            .iter()
            .find(|v| v.id == "Kore")
            .unwrap();
        assert_eq!(kore.description, "Firm, middle pitch");
        assert_eq!(VoiceProvider::Rime.voices()[0].name, "Aurora");
    }
}
