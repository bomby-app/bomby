// App commands listed here get `allow-<command>` permissions, and then a window can call a
// command only if one of its capabilities (capabilities/*.json) grants it. Keep this list in
// sync with generate_handler! in lib.rs.
const COMMANDS: &[&str] = &[
    "open_settings",
    "app_log",
    "credentials_info",
    "save_credentials",
    "clear_credentials",
    "has_gemini_key",
    "save_gemini_key",
    "clear_gemini_key",
    "agents_status",
    "refresh_agents",
    "open_call",
    "call_token",
    "end_call",
    "save_message",
    "call_messages",
    "delete_call",
    "voice_settings",
    "set_voice",
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
