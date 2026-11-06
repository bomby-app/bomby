//! Who Bomby talks through: the voice providers the agent has (`agent/voice_providers/`),
//! their voices and options, and what the user picked, kept in the database's `settings`
//! table ([decision](../../../docs/decisions/voice-providers-like-harnesses.md)). Each
//! provider's key is in the keychain (`credentials`). A pick applies from the next call.

use std::collections::BTreeMap;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::credentials::{KEYS_CHANGED, Vault};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::settings::{get, put};

const PROVIDER_KEY: &str = "voice_provider";

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

/// Gemini's 30 prebuilt voices: name, style and pitch, as Google lists them for Gemini 3.8
/// (ai.google.dev/gemini-api/docs/speech-generation#voices, and AI Studio for the pitch,
/// 2026-11-04). Live supports all of them. The larger voice library and custom voices
/// (`GET /v1beta/voices`) are left out on purpose.
const GEMINI_VOICES: [(&str, &str, &str); 30] = [
    ("Zephyr", "Bright", "Higher"),
    ("Puck", "Upbeat", "Middle"),
    ("Charon", "Informative", "Lower"),
    ("Kore", "Firm", "Middle"),
    ("Fenrir", "Excitable", "Lower middle"),
    ("Leda", "Youthful", "Higher"),
    ("Orus", "Firm", "Lower middle"),
    ("Aoede", "Breezy", "Middle"),
    ("Callirrhoe", "Easy-going", "Middle"),
    ("Autonoe", "Bright", "Middle"),
    ("Enceladus", "Breathy", "Lower"),
    ("Iapetus", "Clear", "Lower middle"),
    ("Umbriel", "Easy-going", "Lower middle"),
    ("Algieba", "Smooth", "Lower"),
    ("Despina", "Smooth", "Middle"),
    ("Erinome", "Clear", "Middle"),
    ("Algenib", "Gravelly", "Lower"),
    ("Rasalgethi", "Informative", "Middle"),
    ("Laomedeia", "Upbeat", "Higher"),
    ("Achernar", "Soft", "Higher"),
    ("Alnilam", "Firm", "Lower middle"),
    ("Schedar", "Even", "Lower middle"),
    ("Gacrux", "Mature", "Middle"),
    ("Pulcherrima", "Forward", "Middle"),
    ("Achird", "Friendly", "Lower middle"),
    ("Zubenelgenubi", "Casual", "Lower middle"),
    ("Vindemiatrix", "Gentle", "Middle"),
    ("Sadachbia", "Lively", "Lower"),
    ("Sadaltager", "Knowledgeable", "Middle"),
    ("Sulafat", "Warm", "Middle"),
];

/// Prism's four voices, its own rather than Rime's TTS voices: id, name and how it sounds,
/// shortened from docs.rime.ai/docs/prism/sessions#choose-a-voice (2026-11-06).
const RIME_VOICES: [(&str, &str, &str); 4] = [
    ("aurora", "Aurora", "Calm and casual, lower pitch"),
    ("wawona", "Wawona", "Bright and polished, higher pitch"),
    ("brando", "Brando", "Low and steady, confident"),
    ("astra", "Astra", "Clear and youthful, energetic"),
];

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

    /// How the app talks about it.
    pub fn name(self) -> &'static str {
        match self {
            Self::Gemini => "Gemini",
            Self::Rime => "Rime",
        }
    }

    /// Where the agent's plugin reads the key (`key_env` in `agent/voice_providers/`).
    pub fn key_env(self) -> &'static str {
        match self {
            Self::Gemini => "GOOGLE_API_KEY",
            Self::Rime => "RIME_API_KEY",
        }
    }

    /// The agent defaults to the same (`default_voice`); Aurora is the owner's pick.
    fn default_voice(self) -> &'static str {
        match self {
            Self::Gemini => "Leda",
            Self::Rime => "aurora",
        }
    }

    fn voices(self) -> Vec<Voice> {
        match self {
            Self::Gemini => GEMINI_VOICES
                .iter()
                .map(|&(name, style, pitch)| Voice {
                    id: name,
                    name,
                    description: format!("{style}, {} pitch", pitch.to_lowercase()),
                })
                .collect(),
            Self::Rime => RIME_VOICES
                .iter()
                .map(|&(id, name, description)| Voice {
                    id,
                    name,
                    description: description.to_owned(),
                })
                .collect(),
        }
    }

    /// Its switches and their defaults, as the agent has them (`options`).
    fn options(self) -> &'static [(&'static str, bool)] {
        match self {
            // Gemini's own Google Search, on Google's side.
            Self::Gemini => &[("google_search", true)],
            Self::Rime => &[],
        }
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

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "voice.ts"))]
pub struct Voice {
    /// What the agent gets: "Kore", "aurora".
    id: &'static str,
    name: &'static str,
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
/// Gemini key stays on Gemini; saved once worked out, like the LiveKit server. None when
/// there's neither a pick nor a key.
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
    Ok(VoiceProvider::ALL
        .into_iter()
        .find(|&p| has_key(p))
        .map(|p| (p, false)))
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
        .iter()
        .map(|&(id, default)| {
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
    if !provider.options().iter().any(|&(id, _)| id == option) {
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
                voices: provider.voices(),
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
    fn ids_match_the_agents_providers() {
        assert_eq!(
            VoiceProvider::ALL.map(VoiceProvider::id),
            ["gemini", "rime"]
        );
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
    fn until_picked_the_first_provider_with_a_key_and_then_the_pick() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn();
        assert_eq!(chosen(&conn, |_| false).unwrap(), None, "nothing to go on");
        assert_eq!(
            chosen(&conn, |p| p == VoiceProvider::Gemini).unwrap(),
            Some(VoiceProvider::Gemini),
            "an install with a Gemini key stays on Gemini"
        );
        // Saved once worked out: a Rime key added later doesn't switch it.
        assert_eq!(
            chosen(&conn, |_| true).unwrap(),
            Some(VoiceProvider::Gemini)
        );

        save_provider(&conn, VoiceProvider::Rime).unwrap();
        assert_eq!(chosen(&conn, |_| false).unwrap(), Some(VoiceProvider::Rime));
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
            .into_iter()
            .find(|v| v.id == "Kore")
            .unwrap();
        assert_eq!(kore.description, "Firm, middle pitch");
        assert_eq!(VoiceProvider::Rime.voices()[0].name, "Aurora");
    }
}
