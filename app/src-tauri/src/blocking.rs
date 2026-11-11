//! Commands that wait on something (the database, the keychain, a program) run on Tauri's
//! blocking pool, never on the async runtime's workers.
//!
//! A sync command marked `#[tauri::command(async)]` runs inside `async_runtime::spawn`, on a
//! tokio worker, and a plain sync command on the main thread (tauri-macros 2.7.4,
//! `command/wrapper.rs`, `body_async` and `body_blocking`). The runtime has a worker per
//! core: a handful of commands each waiting on a lock held long (a keychain prompt, a
//! deadlock) would park every worker, and then nothing async moves, the windows' other
//! commands, the sockets and the looks included. On the blocking pool a long wait holds up
//! only the commands that need what it holds.

use tauri::{AppHandle, Runtime};

use crate::error::Result;

/// Runs `work` on the blocking pool and waits for its answer without holding a worker.
pub async fn blocking<R: Runtime, T: Send + 'static>(
    app: AppHandle<R>,
    work: impl FnOnce(&AppHandle<R>) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || work(&app)).await?
}
