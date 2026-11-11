//! Who Bomby talks through: the voice providers the agent has (`agent/voice_providers/`),
//! their voices and options, and what the user picked, kept in the database's `settings`
//! table ([decision](../../../docs/decisions/voice-providers-like-harnesses.md)). Each
//! provider's key is in the keychain (`credentials`). A pick applies from the next call.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::blocking::blocking;
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
    /// OpenAI's GPT-Live, with an OpenAI key.
    #[serde(rename = "openai")]
    #[cfg_attr(test, ts(rename = "openai"))]
    OpenAi,
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
    options: Vec<OptionDef>,
}

/// One of a provider's options, as the agent defines it (`Switch` and `Choice` in
/// `agent/voice_providers/provider.py`).
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum OptionDef {
    /// On or off: Gemini's Google Search.
    Switch { id: String, default: bool },
    /// One of its values: GPT-Live's response model.
    Choice {
        id: String,
        default: String,
        values: Vec<String>,
        /// The choice whose value decides which of these values there are.
        follows: Option<String>,
        /// With `follows`: the values for each of its values; one not listed has them all.
        #[serde(default)]
        per: BTreeMap<String, Vec<String>>,
    },
}

impl OptionDef {
    fn id(&self) -> &str {
        match self {
            Self::Switch { id, .. } | Self::Choice { id, .. } => id,
        }
    }
}

/// What an option is set to: a switch's on or off, a choice's value. Sent to the agent and
/// taken from the page as JSON `true`/`false` or a string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "voice.ts"))]
pub enum OptionValue {
    On(bool),
    Value(String),
}

impl VoiceProvider {
    pub const ALL: [Self; 3] = [Self::Gemini, Self::OpenAi, Self::Rime];

    /// Its id in the job's metadata (`PROVIDERS` in `agent/voice_providers/`).
    pub fn id(self) -> &'static str {
        match self {
            Self::Gemini => "gemini",
            Self::OpenAi => "openai",
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

    /// Its options, in the order the agent lists them (`options`).
    fn options(self) -> &'static [OptionDef] {
        &self.entry().options
    }

    /// Where its voice is saved; Gemini keeps the key every install had before.
    fn voice_setting(self) -> String {
        match self {
            Self::Gemini => "voice".to_owned(),
            Self::OpenAi | Self::Rime => format!("voice_{}", self.id()),
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

/// One of a provider's options as Settings shows it: a switch, or a choice with the values
/// it has now (an effort, the ones its response model has).
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "voice.ts"))]
pub enum ProviderOption {
    Switch {
        id: &'static str,
        on: bool,
    },
    Choice {
        id: &'static str,
        value: String,
        values: Vec<&'static str>,
    },
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
    /// The pick, else the first provider with a saved key, else Gemini (`chosen`).
    provider: VoiceProvider,
    providers: Vec<ProviderSettings>,
}

/// What a call talks through (`calls::dispatch_metadata`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CallVoice {
    pub(crate) provider: VoiceProvider,
    pub(crate) voice: String,
    pub(crate) options: BTreeMap<&'static str, OptionValue>,
}

/// The picked provider. Until one is: the first with a saved key, so an install that had a
/// Gemini key stays on Gemini, else Gemini; saved once worked out, like the LiveKit server.
pub(crate) fn chosen(
    conn: &Connection,
    has_key: impl Fn(VoiceProvider) -> bool,
) -> Result<VoiceProvider> {
    let (provider, saved) = picked(conn, has_key)?;
    if !saved {
        save_provider(conn, provider)?;
    }
    Ok(provider)
}

/// What `chosen` finds, without saving it, and whether it was saved already.
fn picked(
    conn: &Connection,
    has_key: impl Fn(VoiceProvider) -> bool,
) -> Result<(VoiceProvider, bool)> {
    if let Some(provider) = get(conn, PROVIDER_KEY)?
        .as_deref()
        .and_then(VoiceProvider::from_id)
    {
        return Ok((provider, true));
    }
    // With no key either, Gemini: the splash and Settings start with it picked (owner,
    // 2026-11-06).
    let first_with_key = VoiceProvider::ALL.into_iter().find(|&p| has_key(p));
    Ok((first_with_key.unwrap_or(DEFAULT_PROVIDER), false))
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
    let conn = db.conn()?;
    let (provider, _) = picked(&conn, |p| keys.contains_key(&p))?;
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

/// Each option as the user set it, else its default. A choice keeps a value only while it's
/// offered (an effort the newly picked response model doesn't have is its default again),
/// the way the agent resolves them (`VoiceProvider.resolve`).
fn options(conn: &Connection, provider: VoiceProvider) -> Result<Vec<ProviderOption>> {
    let mut resolved: Vec<ProviderOption> = Vec::new();
    for option in provider.options() {
        let saved = get(conn, &provider.option_setting(option.id()))?;
        resolved.push(match option {
            OptionDef::Switch { id, default } => ProviderOption::Switch {
                id,
                on: match saved.as_deref() {
                    Some("1") => true,
                    Some("0") => false,
                    _ => *default,
                },
            },
            OptionDef::Choice { id, default, .. } => {
                let values = offered(option, &resolved);
                let value = match saved {
                    Some(value) if values.contains(&value.as_str()) => value,
                    _ if values.contains(&default.as_str()) => default.clone(),
                    _ => values.first().map_or_else(String::new, |v| (*v).to_owned()),
                };
                ProviderOption::Choice { id, value, values }
            }
        });
    }
    Ok(resolved)
}

/// The values a choice has, given what the options before it are set to.
fn offered(option: &'static OptionDef, before: &[ProviderOption]) -> Vec<&'static str> {
    let OptionDef::Choice {
        values,
        follows,
        per,
        ..
    } = option
    else {
        return Vec::new();
    };
    let leader = follows.as_deref().and_then(|follows| {
        before.iter().find_map(|option| match option {
            ProviderOption::Choice { id, value, .. } if *id == follows => Some(value.as_str()),
            _ => None,
        })
    });
    leader
        .and_then(|leader| per.get(leader))
        .unwrap_or(values)
        .iter()
        .map(String::as_str)
        .collect()
}

/// The options as the call's metadata carries them (`provider_options`).
fn option_values(options: Vec<ProviderOption>) -> BTreeMap<&'static str, OptionValue> {
    options
        .into_iter()
        .map(|option| match option {
            ProviderOption::Switch { id, on } => (id, OptionValue::On(on)),
            ProviderOption::Choice { id, value, .. } => (id, OptionValue::Value(value)),
        })
        .collect()
}

/// Saves a switch as "1" or "0", where it always was, and a choice as its value, once it's
/// one the choice has now.
fn save_option(
    conn: &Connection,
    provider: VoiceProvider,
    option: &str,
    value: &OptionValue,
) -> Result<()> {
    let def = provider
        .options()
        .iter()
        .find(|def| def.id() == option)
        .ok_or_else(|| Error::Invalid(format!("{} has no option {option}.", provider.name())))?;
    let saved = match (def, value) {
        (OptionDef::Switch { .. }, OptionValue::On(on)) => if *on { "1" } else { "0" }.to_owned(),
        (OptionDef::Choice { .. }, OptionValue::Value(value)) => {
            if !offered(def, &options(conn, provider)?).contains(&value.as_str()) {
                return Err(Error::Invalid(format!(
                    "{value} isn't one of {}'s choices for {option}.",
                    provider.name()
                )));
            }
            value.clone()
        }
        _ => {
            return Err(Error::Invalid(format!(
                "{}'s {option} can't be set to that.",
                provider.name()
            )));
        }
    };
    put(conn, &provider.option_setting(option), &saved)
}

pub(crate) fn for_call(conn: &Connection, provider: VoiceProvider) -> Result<CallVoice> {
    Ok(CallVoice {
        provider,
        voice: voice(conn, provider)?,
        options: option_values(options(conn, provider)?),
    })
}

/// The picked provider for a new call, with its key: what the worker needs. Fails with
/// what to add when the key is missing.
pub(crate) fn for_new_call<R: Runtime>(
    app: &AppHandle<R>,
    db: &Db,
    vault: &Vault,
) -> Result<VoiceProvider> {
    let keys = vault.voice_keys(app)?;
    let provider = chosen(&*db.conn()?, |p| keys.contains_key(&p))?;
    if !keys.contains_key(&provider) {
        return Err(Error::Invalid(format!(
            "Add your {} API key in Settings, Voice first.",
            provider.name()
        )));
    }
    Ok(provider)
}

#[tauri::command]
pub async fn voice_settings<R: Runtime>(app: AppHandle<R>) -> Result<VoiceSettings> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        let vault = app.state::<Vault>();
        let keys = vault.voice_keys(app)?;
        let conn = db.conn()?;
        let providers = VoiceProvider::ALL
            .into_iter()
            .map(|provider| {
                Ok(ProviderSettings {
                    provider,
                    has_key: keys.contains_key(&provider),
                    voice: voice(&conn, provider)?,
                    default_voice: provider.default_voice(),
                    voices: provider.voices().to_vec(),
                    options: options(&conn, provider)?,
                })
            })
            .collect::<Result<_>>()?;
        Ok(VoiceSettings {
            provider: chosen(&conn, |p| keys.contains_key(&p))?,
            providers,
        })
    })
    .await
}

/// Applies from the next call. Every window hears keys-changed, since whether a call can
/// start depends on the provider's key.
#[tauri::command]
pub async fn set_voice_provider<R: Runtime>(
    app: AppHandle<R>,
    provider: VoiceProvider,
) -> Result<()> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        save_provider(&*db.conn()?, provider)?;
        let _ = app.emit(KEYS_CHANGED, ());
        Ok(())
    })
    .await
}

/// The voice for the provider's next call; a call that's running keeps its voice.
#[tauri::command]
pub async fn set_voice<R: Runtime>(
    app: AppHandle<R>,
    provider: VoiceProvider,
    voice: String,
) -> Result<()> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        save_voice(&*db.conn()?, provider, &voice)
    })
    .await
}

/// A switch's on or off, or a choice's value, for the provider's next call.
#[tauri::command]
pub async fn set_voice_option<R: Runtime>(
    app: AppHandle<R>,
    provider: VoiceProvider,
    option: String,
    value: OptionValue,
) -> Result<()> {
    blocking(app, move |app| {
        let db = app.state::<Db>();
        save_option(&*db.conn()?, provider, &option, &value)
    })
    .await
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
        let conn = db.conn().unwrap();
        assert_eq!(
            chosen(&conn, |p| p == VoiceProvider::Rime).unwrap(),
            VoiceProvider::Rime,
            "an install with only a Rime key starts on Rime"
        );
        // Saved once worked out: a key added later doesn't switch it.
        assert_eq!(chosen(&conn, |_| true).unwrap(), VoiceProvider::Rime);

        save_provider(&conn, VoiceProvider::Gemini).unwrap();
        assert_eq!(chosen(&conn, |_| false).unwrap(), VoiceProvider::Gemini);

        let fresh = Db::in_memory().unwrap();
        assert_eq!(
            chosen(&fresh.conn().unwrap(), |_| false).unwrap(),
            VoiceProvider::Gemini,
            "a new install starts on Gemini"
        );
    }

    #[test]
    fn looking_without_choosing_saves_nothing() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        let gemini = |p| p == VoiceProvider::Gemini;
        assert_eq!(
            picked(&conn, gemini).unwrap(),
            (VoiceProvider::Gemini, false)
        );
        assert_eq!(get(&conn, PROVIDER_KEY).unwrap(), None);
    }

    #[test]
    fn each_provider_keeps_its_own_voice() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
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
        let conn = db.conn().unwrap();
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
        let conn = db.conn().unwrap();
        let search =
            |conn: &Connection| option_values(options(conn, VoiceProvider::Gemini).unwrap());
        let on = |on| BTreeMap::from([("google_search", OptionValue::On(on))]);
        assert_eq!(search(&conn), on(true));
        save_option(
            &conn,
            VoiceProvider::Gemini,
            "google_search",
            &OptionValue::On(false),
        )
        .unwrap();
        assert_eq!(search(&conn), on(false));
        // Saved where every install had it.
        assert_eq!(
            get(&conn, "voice_option.gemini.google_search")
                .unwrap()
                .as_deref(),
            Some("0")
        );
        assert!(matches!(
            save_option(
                &conn,
                VoiceProvider::Gemini,
                "google_search",
                &OptionValue::Value("yes".into())
            ),
            Err(Error::Invalid(_))
        ));

        assert!(options(&conn, VoiceProvider::Rime).unwrap().is_empty());
        assert!(matches!(
            save_option(
                &conn,
                VoiceProvider::Rime,
                "google_search",
                &OptionValue::On(true)
            ),
            Err(Error::Invalid(_))
        ));
    }

    #[test]
    fn an_effort_follows_the_response_model() {
        let db = Db::in_memory().unwrap();
        let conn = db.conn().unwrap();
        let openai = VoiceProvider::OpenAi;
        let set = |option: &str, value: &str| {
            save_option(&conn, openai, option, &OptionValue::Value(value.into()))
        };
        let value = |id: &str| option_values(options(&conn, openai).unwrap())[id].clone();
        let text = |v: &str| OptionValue::Value(v.into());

        assert_eq!(value("web_search"), OptionValue::On(true));
        assert_eq!(value("response_model"), text("gpt-6-luna"));
        assert_eq!(value("reasoning_effort"), text("medium"));

        set("reasoning_effort", "none").unwrap();
        assert_eq!(value("reasoning_effort"), text("none"));
        // Astra has no "none": its effort is the default again, and "none" can't be picked.
        set("response_model", "gpt-6-astra").unwrap();
        assert_eq!(value("reasoning_effort"), text("medium"));
        assert!(matches!(
            set("reasoning_effort", "none"),
            Err(Error::Invalid(_))
        ));
        let ProviderOption::Choice { values, .. } = &options(&conn, openai).unwrap()[2] else {
            panic!("the effort is a choice");
        };
        assert_eq!(values, &["low", "medium", "high", "xhigh"]);
        // Back on Luna, the saved "none" holds again.
        set("response_model", "gpt-6-luna").unwrap();
        assert_eq!(value("reasoning_effort"), text("none"));

        assert!(matches!(
            set("response_model", "gpt-5"),
            Err(Error::Invalid(_))
        ));
        // A model saved before it was retired reads as the default, and the effort follows.
        put(&conn, &openai.option_setting("response_model"), "gpt-5").unwrap();
        assert_eq!(value("response_model"), text("gpt-6-luna"));
        assert_eq!(value("reasoning_effort"), text("none"));
        assert!(matches!(
            save_option(&conn, openai, "response_model", &OptionValue::On(true)),
            Err(Error::Invalid(_))
        ));
        assert_eq!(voice(&conn, openai).unwrap(), "gleam");
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
