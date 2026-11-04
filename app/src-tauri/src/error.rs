//! The one error type commands return. The page receives it as a plain message string.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Input the user can fix; the message is shown as is.
    #[error("{0}")]
    Invalid(String),
    /// The thing the page asked for is gone (deleted in another window, say).
    #[error("{0} not found")]
    NotFound(&'static str),
    #[error("database: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("keychain: {0}")]
    Keychain(#[from] keyring::Error),
    #[error("stored credentials are unreadable: {0}")]
    Corrupt(#[from] serde_json::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
