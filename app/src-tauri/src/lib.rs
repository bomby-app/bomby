//! The Tauri core of the desktop app: windows, the permission prompt for the mic, the app's
//! database, and the commands the page calls. Each command's module documents it;
//! capabilities/ grants them.

mod credentials;
mod db;
mod error;
mod projects;
mod windows;

use tauri::Manager;
use tauri::webview::{PermissionKind, PermissionResponse};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // The page asks the webview for the mic; grant it here so only the operating
        // system's own prompt appears (macOS shows NSMicrophoneUsageDescription from
        // Info.plist). Everything else keeps the webview's default behavior.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Microphone => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .setup(|app| {
            // ~/Library/Application Support/com.aburady.claudible on macOS.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(db::Db::open(&dir.join(db::FILE_NAME))?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            windows::open_settings,
            credentials::credentials_info,
            credentials::save_credentials,
            credentials::clear_credentials,
            projects::list_projects,
            projects::create_project,
            projects::update_project,
            projects::delete_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
