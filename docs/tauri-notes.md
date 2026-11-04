# Tauri notes

Checked 2026-11-03/04 against Tauri 2.12.5, `tauri-codegen` 2.7.4, `wry` 0.57.1, Cargo registry sources and v2.tauri.app. Scaffolded with `create-tauri-app` 4.8.0 (`react-ts`, bun).

## App model

- `app/src` is the React/Vite webview; `app/src-tauri` is the native Rust core. The core owns files, keychain, processes and windows.
- JS calls `#[tauri::command]` functions with `invoke`; Rust pushes events. Capabilities in `src-tauri/capabilities/*.json` grant every core, plugin and app-command permission.
- `tauri.conf.json` configures identity, windows, dev server, frontend and bundles. Dev loads Vite at port 1420; build embeds `dist/` and creates native bundles.
- `main.rs` calls `bomby_lib::run()` in `lib.rs`; the split supports mobile targets.

## Microphone

- macOS requires `NSMicrophoneUsageDescription` in `src-tauri/Info.plist`. The CLI merges it into bundles and embeds it in macOS debug binaries (`tauri-codegen` `context.rs`).
- WKWebView asks the app for capture permission, then macOS TCC asks the user. `Builder::on_permission_request` (Tauri 2.12) allows the webview request in `lib.rs`, leaving only the OS prompt.
- A dev process launched from a terminal may use the terminal's mic permission and show no prompt. The built `.app` has its own TCC identity and prompt.
- Linux WebKitGTK generally lacks usable WebRTC ([decision](decisions/desktop-app-on-tauri-v2.md)).

## Window

- macOS uses `titleBarStyle: "Overlay"` and `hiddenTitle`. The page supplies drag regions; unfocused-window dragging has a known caveat (tauri-apps/tauri#4316).
- `data-tauri-drag-region` applies only to the element, not children; use `pointer-events-none` on inner text. Requires `core:window:allow-start-dragging`.
- `trafficLightPosition` is a logical inset to the close button. Only x moves buttons directly; y also changes title-bar height (`tao` 0.37.2). Both windows use `{20, 30}`, confirmed visually on macOS 27; remeasure after OS updates.
- `getCurrentWindow().setTheme("light" | "dark" | null)` matches native appearance to the theme provider and requires `core:window:allow-set-theme`.

## Windows and commands

- `main` comes from config; `src/windows.rs` builds others with `WebviewWindowBuilder`. Each loads its own Vite page listed in `build.rolldownOptions.input` (Vite 8).
- `open_settings` creates its window hidden, centers it on the main window in physical pixels, then shows it. It is async because synchronous window creation can deadlock Windows.
- `zoomHotkeysEnabled` / `zoom_hotkeys_enabled(true)` enables Cmd/Ctrl + = - 0 and needs `core:webview:allow-set-webview-zoom` on macOS/Linux.
- `windows/mount.tsx` suppresses the web context menu except in text fields and selections, preserving Cut/Copy/Paste there. Window close from JS needs `core:window:allow-close`.
- Sync commands run on the main thread; `#[tauri::command(async)]` moves blocking work such as keychain access to the async runtime.
- `build.rs` lists app commands in `AppManifest::commands`, generating `allow-<command>` permissions. `main.json` grants `open_settings`; only `settings.json` grants credential commands.
- `emit` broadcasts to every webview. Commands return `Result<T, error::Error>`; the page receives the error message as a rejected promise.

## Agent worker

- `src-tauri/src/agent.rs` keeps one worker per app run. The first `open_call` starts it; credential or `claude` path changes, or its death, restart it; app exit stops it.
- Debug runs `uv run python agent.py start` in `agent/`, found at build time from `CARGO_MANIFEST_DIR`. Release builds await the sidecar.
- The environment passes LiveKit/Gemini keys and `CLAUDE_CODE_EXECUTABLE`; `child_environment` removes secrets before launching Claude.
- The worker has its own process group. Normal shutdown uses SIGTERM, five seconds, then SIGKILL.
- `BOMBY_EXIT_WITH_APP=1` plus a core-held stdin pipe ensures the worker cannot outlive the app. `agent/lifeline.py` stops the group on EOF (SIGTERM, three seconds, SIGKILL), covering crashes and Ctrl-C.
- Logs go to `agent.log` in `app.path().app_log_dir()`, rewritten per start. The page's `app_log` command writes webview audio facts to `app.log` there. Startup errors surface the worker's last JSON error.

## Finding agents

- Finder launches provide launchd's PATH, not the shell's. `src-tauri/src/agents.rs` queries the login shell once (`$SHELL -ilc`, eight-second timeout), ignores rc-file noise, then checks known install locations.
- Settings strips version prefixes from `opencode --version` and `omp --version`. Claude sign-in comes from `claude auth status --json`; version from `claude --version`.
- See [detection decision](decisions/detect-acp-native-agents.md).

## Credentials

- `keyring` 4.2.0 with `v1` uses Keychain, Windows Credential Manager or Secret Service. One entry (service = app identifier, account `credentials`) stores JSON for LiveKit and Gemini.
- `credentials::Vault` reads once per run and caches in Tauri state. The page receives URL, API key and boolean secret presence, never the secrets.
- Ad-hoc-signed dev rebuilds can trigger another macOS keychain prompt because each binary is a new trust identity. A Developer ID release keeps a stable identity.

## Storage

- `rusqlite` 0.41.1 with `bundled`, behind `Mutex<Connection>` in Tauri state. `bomby.db` lives in `app_data_dir` and is created in `Builder::setup`.
- Append-only SQL migrations run in transactions; `PRAGMA user_version` tracks them. Never edit a shipped migration.
- Enable `foreign_keys` per connection for cascades and use WAL for concurrent reads during writes.
- Use `i64`, not `usize`, for SQL integers. Timestamps are integer epoch milliseconds, read in JS with `new Date(ms)`.

## Dialogs and clipboard

- `tauri-plugin-dialog` 2.8.4 provides the native multi-folder picker: `open({ directory: true, multiple: true })` resolves to `string[] | null`. Only the main window has `dialog:allow-open`.
- Settings uses `tauri-plugin-clipboard-manager` 2 for Paste all and copying install commands. Scoped read/write permissions avoid WKWebView's separate Paste prompt. Ordinary paste events need no plugin permission.

## Icons

`just app icon` rebuilds all icons. Checked with Xcode/actool 27.2, tauri-cli 2.12.4 and tauri-bundler 2.10.4 on macOS 27.

- **macOS 26+.** `src-tauri/icons/Bomby.icon/` is an Icon Composer folder with `icon.json` and bubble/eyes SVG layers. Edit in Icon Composer; Apple's guide covers the 1024 canvas, groups and SVG layers.
- **Undocumented format.** The file follows Icon Composer output and github.com/peterpoliwoda/icon-composer-template. It uses top-level/per-layer `fill-specializations`, front-first `groups`, `glass`, `lighting`, `specular`, `blur-material`, `shadow`, `translucency` and macOS `supported-platforms`. Gradient fills specify top/bottom colors and orientation; colors use `srgb:r,g,b,a`. actool 27.2 rejects `color-space-for-untagged-svg-colors`, so omit it.
- **Bundler bug.** `tauri build` cannot compile this `.icon`: actool fails through persistent `ibtoold` (tauri-apps/tauri#16386). `app/scripts/compile-app-icon.sh` kills `ibtoold`, runs actool with stdin closed, retries three times and writes checked-in `Assets.car`.
- `bundle.macOS.files` copies `Assets.car`; Info.plist sets `CFBundleIconName = Bomby`; `.icon` stays out of `bundle.icon`. After #16386 is fixed, remove the script/file entry/plist workaround and bundle the `.icon` directly.
- **Older platforms.** `tauri icon` on `app-icon.png` generates ICNS, ICO and PNGs; the recipe removes mobile outputs. Pre-26 macOS uses `CFBundleIconFile = icon.icns`.

## DMG window

- `bundle.macOS.dmg` configures background, 660 x 400 window, app at (180, 200) and Applications at (480, 200).
- `just app icon` combines 1x/2x backgrounds into `dmg-background.tiff` with `tiffutil -cathidpicheck`. The bundler copies it and writes `.DS_Store`.
- Check icon-label contrast in Finder's dark mode; Finder chooses the label color.

## Dock icon in dev

Without a bundle, Tauri sets the Dock icon from the first ICNS in `bundle.icon` at `RunEvent::Ready`. macOS 26 may put this older-format icon on a plate; judge the built app's `Assets.car` rendition instead.

## Toolchain

Rust 1.99.1 and bun 1.4.4 are pinned in `mise.toml`; macOS also needs Xcode Command Line Tools. `just app check` runs Clippy, fmt, TypeScript and Biome ([frontend notes](frontend-notes.md)).
