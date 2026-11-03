//! The Tauri core of the desktop app: windows, the permission prompt for the mic, and the
//! commands the page calls. Each command's module documents it; capabilities/ grants them.

mod credentials;
mod error;
mod windows;

use tauri::webview::{PermissionKind, PermissionResponse};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // The page asks the webview for the mic; grant it here so only the operating
        // system's own prompt appears (macOS shows NSMicrophoneUsageDescription from
        // Info.plist). Everything else keeps the webview's default behavior.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Microphone => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .invoke_handler(tauri::generate_handler![
            windows::open_settings,
            credentials::credentials_info,
            credentials::save_credentials,
            credentials::clear_credentials,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
