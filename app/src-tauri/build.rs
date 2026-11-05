// App commands listed here get `allow-<command>` permissions, and then a window can call a
// command only if one of its capabilities (capabilities/*.json) grants it. Keep this list in
// sync with generate_handler! in lib.rs.
const COMMANDS: &[&str] = &[
    "open_settings",
    "set_tray_status",
    "task_finished",
    "about",
    "check_for_updates",
    "install_update",
    "app_log",
    "credentials_info",
    "save_credentials",
    "clear_credentials",
    "has_gemini_key",
    "save_gemini_key",
    "clear_gemini_key",
    "livekit_server",
    "set_livekit_server",
    "agents_status",
    "refresh_agents",
    "agent_settings",
    "pick_agent_settings",
    "install_adapters",
    "open_call",
    "call_token",
    "end_call",
    "save_message",
    "call_messages",
    "delete_call",
    "voice_settings",
    "set_voice",
    "user_name",
    "set_user_name",
    "tone",
    "set_tone",
    "first_run",
    "finish_first_run",
    "list_projects",
    "create_project",
    "update_project",
    "delete_project",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
