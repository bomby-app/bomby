//! The Tauri core of the desktop app: windows, the menu bar icon, notifications, updates, Export Diagnostics, the permission prompt for the mic, the app's
//! database, extensions and their data, the workspace panel's terminals, git changes and files, the Agents panel's live streams, and the commands the page calls. Each command's module documents it;
//! capabilities/ grants them.

mod adapters;
mod agent;
mod agent_checks;
mod agent_picks;
mod agent_streams;
mod agents;
mod app_log;
mod blocking;
mod call_server;
mod calls;
mod credentials;
mod db;
mod dev;
mod diagnostics;
mod dirs;
mod error;
mod extensions;
mod local_server;
mod local_socket;
mod notifications;
mod process;
mod projects;
mod search;
mod settings;
mod setup;
mod smoke;
mod sync;
#[cfg(test)]
mod testing;
mod tray;
mod updates;
mod voice;
mod windows;
mod workspace;

use tauri::Manager;
use tauri::webview::{PermissionKind, PermissionResponse};

/// Everything the app sets up at launch: its folders, database and state, the menu bar
/// icon, the first look for the agents, and the main window.
fn launch(app: &mut tauri::App) -> std::result::Result<(), Box<dyn std::error::Error>> {
    // The app's folders, or the smoke check's (smoke.rs).
    let dirs = dirs::Dirs::for_app(app.handle())?;
    let dir = dirs.data.clone();
    let log_dir = dirs.logs.clone();
    std::fs::create_dir_all(&dir)?;
    app.manage(dirs);
    app.manage(smoke::Smoke::default());
    adapters::init(&dir);
    app.manage(db::Db::open(&dir.join(db::FILE_NAME))?);
    app.manage(agent::AgentWorker::default());
    app.manage(local_server::LocalServer::new(
        local_server::bundled()?,
        dir.clone(),
        log_dir,
    ));
    // `just app dev --no-keys` and the smoke check keep the keys in memory and leave
    // the keychain alone.
    app.manage(if dev::no_keys() || smoke::active() {
        credentials::Vault::in_memory()
    } else {
        credentials::Vault::default()
    });
    app.manage(extensions::connections::Connections::default());
    app.manage(extensions::tokens::Tokens(extensions::tokens::start(
        app.handle(),
    )));
    app.manage(agent_streams::start(app.handle()));
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
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(found) = agents::refresh_in_background(handle.clone()).await {
            smoke::core_ready(&handle, found.len());
        }
    });
    // Both use the network; the smoke check needs none.
    if !smoke::active() {
        adapters::update_in_background(app.handle());
        updates::check_in_background(app.handle());
    }
    windows::place_main(app.handle())?;
    Ok(())
}

/// The launch failed (an unreadable database, a migration that fails, a missing part of the
/// app): it goes to `app.log` and a dialog says so; Bomby quits once it's closed. The main
/// window stays hidden: nothing it needs was set up.
fn launch_failed<R: tauri::Runtime>(app: &tauri::AppHandle<R>, error: &str) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    let line = format!("Bomby couldn't open: {error}");
    eprintln!("{line}");
    // Before the folders were set, the app's own log folder; if that fails too, stderr is
    // all there is.
    let logged = app_log::append(app, &line).is_ok()
        || app
            .path()
            .app_log_dir()
            .is_ok_and(|dir| app_log::append_in(&dir, &line).is_ok());
    // The smoke check waits for no one to close a dialog: it fails now, with stderr.
    if smoke::active() {
        app.exit(1);
        return;
    }
    let handle = app.clone();
    app.dialog()
        .message(format!(
            "{error}\n\nBomby quits when you close this. Open it again; if this keeps happening, report it with {}.",
            if logged {
                "app.log from ~/Library/Logs/app.bomby.desktop"
            } else {
                "this message"
            }
        ))
        .title("Bomby couldn't open")
        .kind(MessageDialogKind::Error)
        .show(move |_| handle.exit(1));
}

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
        // A launch that fails says why, in a dialog and in app.log, and quits: never a Dock
        // icon that bounces and vanishes with nothing said (`launch_failed`).
        .setup(|app| {
            if let Err(e) = launch(app) {
                launch_failed(app.handle(), &e.to_string());
            }
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
            credentials::agent_keys,
            credentials::save_agent_key,
            credentials::clear_agent_key,
            credentials::read_keys_again,
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
            windows::main_window_ready,
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
            agent_streams::watch_agent_streams,
            agent_streams::unwatch_agent_streams,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|app, event| match event {
            // The agent worker, the LiveKit server and the terminals' shells would outlive
            // the app otherwise.
            // Each only if the launch got as far as setting it up (`launch_failed`).
            tauri::RunEvent::Exit => {
                if let Some(worker) = app.try_state::<agent::AgentWorker>() {
                    worker.shutdown();
                }
                if let Some(terminals) = app.try_state::<workspace::terminals::TerminalsState>() {
                    terminals.0.close_all();
                }
                if let Some(server) = app.try_state::<local_server::LocalServer>() {
                    server.stop();
                }
                if let Some(tokens) = app.try_state::<extensions::tokens::Tokens>()
                    && let Some(socket) = &tokens.0
                {
                    socket.stop();
                }
                if let Some(streams) = app.try_state::<agent_streams::AgentStreams>()
                    && let Some(socket) = &streams.socket
                {
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
