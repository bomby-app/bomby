// App commands listed here get `allow-<command>` permissions, and then a window can call a
// command only if one of its capabilities (capabilities/*.json) grants it. Keep this list in
// sync with generate_handler! in lib.rs.
const COMMANDS: &[&str] = &[
    "open_settings",
    "credentials_info",
    "save_credentials",
    "clear_credentials",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
