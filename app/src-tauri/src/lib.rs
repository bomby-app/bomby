//! The Tauri core of the desktop app: windows, the menu bar icon, notifications, the permission prompt for the mic, the app's
//! database, and the commands the page calls. Each command's module documents it;
//! capabilities/ grants them.

mod adapters;
mod agent;
mod agents;
mod app_log;
mod calls;
mod credentials;
mod db;
mod error;
mod notifications;
mod process;
mod projects;
mod settings;
mod setup;
mod tray;
mod windows;

use tauri::Manager;
use tauri::webview::{PermissionKind, PermissionResponse};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
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
            adapters::init(&dir);
            app.manage(db::Db::open(&dir.join(db::FILE_NAME))?);
            app.manage(agent::AgentWorker::default());
            app.manage(credentials::Vault::default());
            app.manage(agents::Agents::default());
            app.manage(calls::CallAgents::default());
            tray::init(app.handle())?;
            notifications::init(app.handle())?;
            // Look for the agents now, so Settings and the first call find them ready.
            tauri::async_runtime::spawn(agents::refresh_in_background(app.handle().clone()));
            adapters::update_in_background(app.handle());
            Ok(())
        })
        // Closing the main window hides it: the app, and any call in it, keeps running in
        // the menu bar until Quit (owner, 2026-11-05). The page, and so the call, lives on.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.label() == windows::MAIN
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            windows::open_settings,
            tray::set_tray_status,
            notifications::task_finished,
            app_log::app_log,
            credentials::credentials_info,
            credentials::save_credentials,
            credentials::clear_credentials,
            credentials::has_gemini_key,
            credentials::save_gemini_key,
            credentials::clear_gemini_key,
            agents::agents_status,
            agents::refresh_agents,
            adapters::install_adapters,
            calls::open_call,
            calls::call_token,
            calls::end_call,
            calls::save_message,
            calls::call_messages,
            calls::delete_call,
            settings::voice_settings,
            settings::set_voice,
            settings::first_run,
            settings::finish_first_run,
            projects::list_projects,
            projects::create_project,
            projects::update_project,
            projects::delete_project,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|app, event| match event {
            // The agent worker is ours to stop: it would outlive the app otherwise.
            tauri::RunEvent::Exit => app.state::<agent::AgentWorker>().shutdown(),
            // A click on the Dock icon brings the (maybe hidden) main window back.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                let _ = windows::show_main(app);
            }
            _ => {}
        });
}
