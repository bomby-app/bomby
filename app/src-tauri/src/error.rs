//! The one error type commands return. The page receives it as a plain message string.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A message for the user, shown as is: input they can fix, or an agent that didn't
    /// answer or take a pick.
    #[error("{0}")]
    Invalid(String),
    /// The thing the page asked for is gone (deleted in another window, say).
    #[error("{0} not found")]
    NotFound(&'static str),
    #[error("database: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("keychain: {0}")]
    Keychain(#[from] keyring::Error),
    /// The keychain entry isn't the JSON this app writes. Only credentials.rs makes it.
    #[error("stored credentials are unreadable: {0}")]
    Corrupt(serde_json::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("git: {0}")]
    Git(#[from] git2::Error),
    #[error("zip: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("notification: {0}")]
    Notification(#[from] tauri_plugin_notification::Error),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
