//! LiveKit credentials (server URL, API key, API secret), kept in the OS secure store:
//! Keychain on macOS, Credential Manager on Windows, Secret Service on Linux.
//!
//! All three live in one entry as JSON, so the OS asks for access once. The secret never goes
//! back to the page: the page sees whether one is saved, and the core will use it to mint
//! call tokens.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::error::{Error, Result};

/// The entry's account name; the service is the app identifier (tauri.conf.json).
const ACCOUNT: &str = "livekit";

#[derive(Serialize, Deserialize)]
struct Stored {
    url: String,
    api_key: String,
    api_secret: String,
}

/// What the page may see.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialsInfo {
    url: String,
    api_key: String,
    has_secret: bool,
}

/// What the page sends. No `api_secret` keeps the saved one.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialsInput {
    url: String,
    api_key: String,
    api_secret: Option<String>,
}

fn entry<R: Runtime>(app: &AppHandle<R>) -> Result<Entry> {
    Ok(Entry::new(&app.config().identifier, ACCOUNT)?)
}

fn load(entry: &Entry) -> Result<Option<Stored>> {
    match entry.get_password() {
        Ok(json) => Ok(Some(serde_json::from_str(&json)?)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// The saved credentials without the secret, or `None` when nothing is saved.
#[tauri::command(async)]
pub fn credentials_info<R: Runtime>(app: AppHandle<R>) -> Result<Option<CredentialsInfo>> {
    Ok(load(&entry(&app)?)?.map(|s| CredentialsInfo {
        url: s.url,
        api_key: s.api_key,
        has_secret: !s.api_secret.is_empty(),
    }))
}

/// Merges the page's input with what is saved: trims, checks, and keeps the saved secret
/// when the input has none.
fn merge(input: CredentialsInput, saved: Option<Stored>) -> Result<Stored> {
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

    Ok(Stored {
        url: url.to_owned(),
        api_key: api_key.to_owned(),
        api_secret,
    })
}

#[tauri::command(async)]
pub fn save_credentials<R: Runtime>(app: AppHandle<R>, input: CredentialsInput) -> Result<()> {
    let entry = entry(&app)?;
    let stored = merge(input, load(&entry)?)?;
    entry.set_password(&serde_json::to_string(&stored)?)?;
    Ok(())
}

#[tauri::command(async)]
pub fn clear_credentials<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    match entry(&app)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
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

    fn saved() -> Option<Stored> {
        Some(Stored {
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
