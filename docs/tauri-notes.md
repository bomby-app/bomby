# Tauri notes

Checked against Tauri 2.12.5 (`tauri` crate; CLI and `@tauri-apps/cli` 2.12.x, released 2026-10-10), `tauri-codegen` 2.7.4, `wry` 0.57.1 (sources in `~/.cargo/registry/src/`), and v2.tauri.app, 2026-11-03. Scaffolded with `create-tauri-app` 4.8.0 (`--template react-ts --manager bun`).

## How a Tauri app is put together

- **Two halves in one app.** The frontend (`app/src`, React built by Vite) is a web page. The core (`app/src-tauri`, Rust) is the native program: it opens the window, shows the page in the OS webview (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux), and does anything the page can't, like files, keychains or spawning processes.
- **The page calls the core** through commands: a Rust function marked `#[tauri::command]`, registered with `invoke_handler`, called from JS with `invoke("name", args)` from `@tauri-apps/api`. The core pushes to the page with events.
- **Capabilities** (`src-tauri/capabilities/*.json`) list what the page may call: core features and plugin permissions. Nothing is reachable from JS unless a capability grants it.
- **Plugins** add features on both sides at once (a Rust crate plus an npm package), such as `opener`, `store`, `sql`, `shell` (sidecars).
- **Config** is `src-tauri/tauri.conf.json`: app name, identifier, window, the dev server URL, the built frontend folder, bundling.
- **Dev vs build.** `tauri dev` runs Vite (`beforeDevCommand`, port 1420) and a debug binary that loads `devUrl`. `tauri build` builds the frontend into `dist/`, embeds it in a release binary, and bundles it (`.app` and `.dmg` on macOS).
- **Rust layout.** `main.rs` only calls `claude_livekit_lib::run()` in `lib.rs`; the lib split exists for mobile targets.

## Microphone

- **macOS needs `NSMicrophoneUsageDescription`.** `src-tauri/Info.plist` is merged into the bundle's Info.plist by the CLI, and in `tauri dev` on macOS it is embedded into the debug binary (`tauri-codegen` `context.rs`, `embed_info_plist!`), so the system prompt works in dev too.
- **Two layers ask.** The webview asks the app before a capture (WKUIDelegate `requestMediaCapturePermission`), and the OS asks the user (macOS TCC, remembered per app in System Settings, Privacy and Security, Microphone). `Builder::on_permission_request` (new in Tauri 2.12) answers the first; `lib.rs` allows the microphone there, so the user only sees the OS prompt.
- **In dev the prompt may not appear.** macOS gives mic access to the "responsible" app, and a `tauri dev` binary started from a terminal counts as the terminal. If the terminal already has mic access, capture just works with no prompt (seen on macOS 27, 2026-11-03, in Rex). The built `.app` is its own app and gets its own prompt, showing the Info.plist text.
- **Linux WebKitGTK** builds generally ship without WebRTC; see [desktop-app-on-tauri-v2](decisions/desktop-app-on-tauri-v2.md).

## Toolchain

- Rust 1.99.1 and bun 1.4.4, pinned in `mise.toml`. macOS also needs the Xcode Command Line Tools.
- `cargo clippy -- -D warnings` and `cargo fmt --check` gate the Rust core; `tsc --noEmit` gates the frontend (`just app check`).
