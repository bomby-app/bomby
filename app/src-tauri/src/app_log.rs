//! A plain log the page can write to, next to `agent.log` in the app's log folder
//! (`~/Library/Logs/com.aburady.claudible/app.log` on macOS). For facts only the page sees,
//! like which microphone the webview actually opened and with what processing.

use std::fs::OpenOptions;
use std::io::Write;

use tauri::{AppHandle, Manager, Runtime};

use crate::db::now_ms;
use crate::error::Result;

/// Appends one line, stamped with the time in milliseconds since the epoch.
#[tauri::command(async)]
pub fn app_log<R: Runtime>(app: AppHandle<R>, line: String) -> Result<()> {
    let dir = app.path().app_log_dir()?;
    std::fs::create_dir_all(&dir)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("app.log"))?;
    writeln!(file, "{} {}", now_ms(), line.replace('\n', " "))?;
    Ok(())
}
