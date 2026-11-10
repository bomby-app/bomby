//! What the core's sockets for the worker share (`extensions::tokens`, `agent_streams`): a
//! Unix socket in a folder only this user can open, and a random secret for the run, both
//! handed to the worker in its environment and never to a coding agent
//! (`APP_KEYS` in `agent/acp_client/environment.py`).

use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use crate::error::{Error, Result};

/// A Unix socket's path is limited to 104 bytes on macOS (`sun_path`).
pub const MAX_SOCKET_PATH: usize = 100;

/// A socket bound in its own folder, listening in non-blocking mode.
pub struct PrivateSocket {
    pub dir: PathBuf,
    pub path: PathBuf,
    pub listener: std::os::unix::net::UnixListener,
}

/// Binds `<parent>/<folder>-<pid>/<file>`, or under `/tmp` when that path is too long for
/// a socket. A folder left by an earlier run with this pid goes first; then only this user
/// may enter it.
pub fn bind(parent: &Path, folder: &str, file: &str) -> Result<PrivateSocket> {
    let name = format!("{folder}-{}", std::process::id());
    let mut dir = parent.join(&name);
    if dir.join(file).as_os_str().len() > MAX_SOCKET_PATH {
        dir = Path::new("/tmp").join(&name);
    }
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::DirBuilder::new().mode(0o700).create(&dir)?;
    let path = dir.join(file);
    let listener = std::os::unix::net::UnixListener::bind(&path)?;
    listener.set_nonblocking(true)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    Ok(PrivateSocket {
        dir,
        path,
        listener,
    })
}

/// A random secret for the run.
pub fn secret() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|e| Error::Invalid(format!("Couldn't make a secret for the worker: {e}")))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Compares in time that doesn't depend on where they differ.
pub fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}
