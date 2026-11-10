//! The Tauri core of the desktop app: windows, the menu bar icon, notifications, updates, Export Diagnostics, the permission prompt for the mic, the app's
//! database, extensions and their data, the workspace panel's terminals, git changes and files, and the commands the page calls. Each command's module documents it;
//! capabilities/ grants them.

mod adapters;
mod agent;
mod agent_picks;
mod agents;
mod app_log;
mod call_server;
mod calls;
mod credentials;
mod db;
mod dev;
mod diagnostics;
mod error;
mod extensions;
mod local_server;
mod notifications;
mod process;
mod projects;
mod search;
mod settings;
mod setup;
mod sync;
mod tray;
mod updates;
mod voice;
mod windows;
mod workspace;

use tauri::Manager;
use tauri::webview::{PermissionKind, PermissionResponse};

pub fn run() {
    let builder = tauri::Builder::default();
    // Only release builds update (updates.rs), so only they load the updater, which won't
    // start without plugins.updater in tauri.conf.json.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
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
            app.manage(local_server::LocalServer::new(
                local_server::bundled()?,
                dir.clone(),
                app.path().app_log_dir()?,
            ));
            app.manage(credentials::Vault::default());
            app.manage(extensions::connections::Connections::default());
            app.manage(extensions::tokens::Tokens(extensions::tokens::start(
                app.handle(),
            )));
            app.manage(agents::Agents::default());
            app.manage(agent_picks::Listings::default());
            app.manage(calls::CallAgents::default());
            app.manage(updates::Updates::default());
            app.manage(diagnostics::Exports::default());
            app.manage(workspace::terminals::TerminalsState::default());
            app.manage(workspace::watch::Watches::default());
            tray::init(app.handle())?;
            notifications::init(app.handle())?;
            // Look for the agents now, so Settings and the first call find them ready.
            tauri::async_runtime::spawn(agents::refresh_in_background(app.handle().clone()));
            adapters::update_in_background(app.handle());
            updates::check_in_background(app.handle());
            windows::place_main(app.handle())?;
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
            updates::about,
            updates::check_for_updates,
            updates::install_update,
            diagnostics::export_diagnostics,
            diagnostics::show_diagnostics,
            app_log::app_log,
            credentials::credentials_info,
            credentials::save_credentials,
            credentials::clear_credentials,
            credentials::save_voice_key,
            credentials::clear_voice_key,
            credentials::has_zep_key,
            credentials::save_zep_key,
            credentials::clear_zep_key,
            settings::memory_setting,
            settings::set_memory_setting,
            settings::memory_incognito,
            settings::set_memory_incognito,
            call_server::livekit_server,
            call_server::set_livekit_server,
            agents::agents_status,
            agents::refresh_agents,
            agent_picks::agent_settings,
            agent_picks::pick_agent_settings,
            adapters::install_adapters,
            calls::open_call,
            calls::call_token,
            calls::end_call,
            calls::save_message,
            calls::call_transcript,
            calls::rename_call,
            calls::delete_call,
            search::search,
            voice::voice_settings,
            voice::set_voice_provider,
            voice::set_voice,
            voice::set_voice_option,
            settings::user_name,
            settings::set_user_name,
            settings::tone,
            settings::set_tone,
            settings::first_run,
            settings::finish_first_run,
            projects::list_projects,
            projects::create_project,
            projects::update_project,
            projects::set_project_agents,
            projects::set_project_extensions,
            extensions::extensions_settings,
            extensions::set_extension,
            extensions::connections::connect_extension,
            extensions::connections::cancel_extension_connect,
            extensions::connections::disconnect_extension,
            extensions::connections::open_extension_link,
            extensions::todos::list_todos,
            extensions::todos::add_todos,
            extensions::todos::update_todo,
            extensions::todos::remove_todo,
            projects::delete_project,
            workspace::changes::folder_info,
            workspace::changes::folder_changes,
            workspace::files::folder_entries,
            workspace::files::folder_file,
            workspace::files::folder_image,
            workspace::watch::watch_folder,
            workspace::watch::unwatch_folder,
            workspace::terminals::terminal_open,
            workspace::terminals::terminal_write,
            workspace::terminals::terminal_resize,
            workspace::terminals::terminal_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|app, event| match event {
            // The agent worker, the LiveKit server and the terminals' shells would outlive
            // the app otherwise.
            tauri::RunEvent::Exit => {
                app.state::<agent::AgentWorker>().shutdown();
                app.state::<workspace::terminals::TerminalsState>()
                    .0
                    .close_all();
                app.state::<local_server::LocalServer>().stop();
                if let Some(socket) = &app.state::<extensions::tokens::Tokens>().0 {
                    socket.stop();
                }
            }
            // A click on the Dock icon brings the (maybe hidden) main window back.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                let _ = windows::show_main(app);
            }
            _ => {}
        });
}
