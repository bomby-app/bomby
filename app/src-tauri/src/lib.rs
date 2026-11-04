//! The Tauri core of the desktop app: windows, the permission prompt for the mic, the app's
//! database, and the commands the page calls. Each command's module documents it;
//! capabilities/ grants them.

mod agent;
mod agents;
mod app_log;
mod calls;
mod credentials;
mod db;
mod error;
mod projects;
mod settings;
mod setup;
mod windows;

use tauri::Manager;
use tauri::webview::{PermissionKind, PermissionResponse};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
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
            // ~/Library/Application Support/app.bomby.desktop on macOS.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(db::Db::open(&dir.join(db::FILE_NAME))?);
            app.manage(agent::AgentWorker::default());
            app.manage(credentials::Vault::default());
            app.manage(agents::Agents::default());
            app.manage(calls::CallAgents::default());
            // Look for the agents now, so Settings and the first call find them ready.
            tauri::async_runtime::spawn(agents::refresh_in_background(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            windows::open_settings,
            app_log::app_log,
            credentials::credentials_info,
            credentials::save_credentials,
            credentials::clear_credentials,
            credentials::has_gemini_key,
            credentials::save_gemini_key,
            credentials::clear_gemini_key,
            agents::agents_status,
            agents::refresh_agents,
            calls::open_call,
            calls::call_token,
            calls::end_call,
            calls::save_message,
            calls::call_messages,
            calls::delete_call,
            settings::voice_settings,
            settings::set_voice,
            projects::list_projects,
            projects::create_project,
            projects::update_project,
            projects::delete_project,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|app, event| {
            // The agent worker is ours to stop: it would outlive the app otherwise.
            if let tauri::RunEvent::Exit = event {
                app.state::<agent::AgentWorker>().shutdown();
            }
        });
}
