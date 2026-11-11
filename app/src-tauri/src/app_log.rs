//! A plain log the page can write to, next to `agent.log` in the app's log folder
//! (`~/Library/Logs/app.bomby.desktop/app.log` on macOS). For facts only the page sees,
//! like which microphone the webview actually opened and with what processing.

use std::fs::OpenOptions;
use std::io::Write;

use tauri::{AppHandle, Runtime};

use crate::db::now_ms;
use crate::error::Result;

/// Its file in the app's log folder.
pub const LOG_FILE: &str = "app.log";

/// Appends one line, stamped with the time in milliseconds since the epoch.
#[tauri::command(async)]
pub fn app_log<R: Runtime>(app: AppHandle<R>, line: String) -> Result<()> {
    append(&app, &line)
}

/// Appends one line from the core: something that went wrong where no page can be told.
pub fn append<R: Runtime>(app: &AppHandle<R>, line: &str) -> Result<()> {
    append_in(&crate::dirs::logs(app)?, line)
}

/// [`append`] to the log in `dir`.
pub fn append_in(dir: &std::path::Path, line: &str) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(LOG_FILE))?;
    writeln!(file, "{} {}", now_ms(), line.replace('\n', " "))?;
    Ok(())
}
