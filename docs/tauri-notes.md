# Tauri notes

Checked against Tauri 2.12.5 (`tauri` crate; CLI and `@tauri-apps/cli` 2.12.x, released 2026-10-10), `tauri-codegen` 2.7.4, `wry` 0.57.1 (sources in `~/.cargo/registry/src/`), and v2.tauri.app, 2026-11-03. Scaffolded with `create-tauri-app` 4.8.0 (`--template react-ts --manager bun`).

## How a Tauri app is put together

- **Two halves in one app.** The frontend (`app/src`, React built by Vite) is a web page. The core (`app/src-tauri`, Rust) is the native program: it opens the window, shows the page in the OS webview (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux), and does anything the page can't, like files, keychains or spawning processes.
- **The page calls the core** through commands: a Rust function marked `#[tauri::command]`, registered with `invoke_handler`, called from JS with `invoke("name", args)` from `@tauri-apps/api`. The core pushes to the page with events.
- **Capabilities** (`src-tauri/capabilities/*.json`) list what the page may call: core features and plugin permissions. Nothing is reachable from JS unless a capability grants it.
- **Plugins** add features on both sides at once (a Rust crate plus an npm package), such as `opener`, `store`, `sql`, `shell` (sidecars).
- **Config** is `src-tauri/tauri.conf.json`: app name, identifier, window, the dev server URL, the built frontend folder, bundling.
- **Dev vs build.** `tauri dev` runs Vite (`beforeDevCommand`, port 1420) and a debug binary that loads `devUrl`. `tauri build` builds the frontend into `dist/`, embeds it in a release binary, and bundles it (`.app` and `.dmg` on macOS).
- **Rust layout.** `main.rs` only calls `claudible_lib::run()` in `lib.rs`; the lib split exists for mobile targets.

## Microphone

- **macOS needs `NSMicrophoneUsageDescription`.** `src-tauri/Info.plist` is merged into the bundle's Info.plist by the CLI, and in `tauri dev` on macOS it is embedded into the debug binary (`tauri-codegen` `context.rs`, `embed_info_plist!`), so the system prompt works in dev too.
- **Two layers ask.** The webview asks the app before a capture (WKUIDelegate `requestMediaCapturePermission`), and the OS asks the user (macOS TCC, remembered per app in System Settings, Privacy and Security, Microphone). `Builder::on_permission_request` (new in Tauri 2.12) answers the first; `lib.rs` allows the microphone there, so the user only sees the OS prompt.
- **In dev the prompt may not appear.** macOS gives mic access to the "responsible" app, and a `tauri dev` binary started from a terminal counts as the terminal. If the terminal already has mic access, capture just works with no prompt (seen on macOS 27, 2026-11-03, in Rex). The built `.app` is its own app and gets its own prompt, showing the Info.plist text.
- **Linux WebKitGTK** builds generally ship without WebRTC; see [desktop-app-on-tauri-v2](decisions/desktop-app-on-tauri-v2.md).

## Window

- **Overlay title bar (macOS).** `tauri.conf.json` sets `titleBarStyle: "Overlay"` and `hiddenTitle`: the page draws under a transparent title bar and the traffic lights float over it. Other platforms ignore both and keep the native title bar. Caveats from the config schema: we must provide our own drag region, and an unfocused window can't be dragged by it (tauri-apps/tauri#4316).
- **Drag regions.** An element with `data-tauri-drag-region` drags the window and double-click zooms it. It applies to that element only, not its children, so text inside a bar gets `pointer-events-none`. Needs `core:window:allow-start-dragging` (not in `core:default`).
- **Traffic light position.** `trafficLightPosition {x, y}` (needs Overlay) is a logical inset from the window's top-left to the close button; tao sets the title bar height to button height + `y` (`tao` 0.37.2 `platform_impl/macos/view.rs`, `inset_traffic_lights`). Only x moves the buttons directly; their height in the taller title bar keeps the default offset, so y is found by measuring. On macOS 27, `y: 21` put the close button's center 18px below the window top, 9.5px above our header's center (measured from the owner's screenshot, 2026-11-03), so we use `{20, 30}` for both windows (`tauri.conf.json`, `windows.rs`); the owner confirmed it lines up. Re-measure after a macOS update.
- **Native theme.** `getCurrentWindow().setTheme("light" | "dark" | null)` sets the window's appearance (null follows the OS); needs `core:window:allow-set-theme`. The theme provider calls it so the title bar and traffic lights match the page.

## Windows and commands

- **More windows.** `main` comes from `tauri.conf.json`; others are built in Rust (`src/windows.rs`, `WebviewWindowBuilder`) so the core owns their size and look. Each loads its own Vite page (`WebviewUrl::App("settings.html")`); `vite.config.ts` lists every page under `build.rolldownOptions.input` (Vite 8's name for `rollupOptions`).
- **Place a window before showing it.** `open_settings` builds the window hidden, moves it to the center of the main window in physical pixels (global across monitors), then shows it. `center()` alone centers on whatever monitor the OS picks.
- **Closing from the page** (`getCurrentWindow().close()`, Esc in Settings) needs `core:window:allow-close`.
- **Build windows from async commands.** A sync command runs on the main thread, and building a window there deadlocks on Windows (Tauri docs), so `open_settings` is `async`.
- **Blocking work off the main thread.** A sync `#[tauri::command]` runs on the main thread (`tauri-macros` 2.7.4 `ExecutionContext::Blocking`); `#[tauri::command(async)]` moves it to the async runtime. The keychain commands use it.
- **App commands are permissioned.** `build.rs` lists our commands in `AppManifest::commands`, which generates `allow-<command>` permissions (`tauri-build` 2.7.4 `acl.rs`); then a window can call a command only if one of its capabilities grants it. `capabilities/main.json` grants `open_settings`; only `capabilities/settings.json` grants the credentials commands.
- **Events reach every window.** `emit` from `@tauri-apps/api/event` broadcasts to all webviews (`core:event:default`). The theme uses it to keep windows in step.
- **Errors.** Commands return `Result<T, error::Error>`; the error serializes as its message, which the page gets as the rejected promise.

## Credentials

- `keyring` 4.2 with its default `v1` feature keeps the v1 API (`Entry::new(service, user)`, `get_password`, `set_password`, `delete_credential`, `Error::NoEntry`) and picks the OS store: Keychain (`apple-native-keyring-store`), Windows Credential Manager, or Secret Service over zbus (`keyring` 4.2.0 `src/v1.rs`).
- One entry: service = the app identifier, account `livekit`, value = JSON `{url, api_key, api_secret}`. The page gets `{url, apiKey, hasSecret}` back, never the secret.
- Expected, not yet confirmed: on macOS a rebuilt dev binary may get a keychain prompt ("wants to use your confidential information") the first time it reads the entry, because its code signature changed. Choose Always Allow; a signed release keeps one identity.

## Storage

- `rusqlite` 0.41 with `bundled` (SQLite compiled in, no system library), behind a `Mutex<Connection>` in Tauri state (`src/db.rs`). The file is `claudible.db` in `app.path().app_data_dir()`, created in `Builder::setup`.
- Migrations are a list of SQL strings; `PRAGMA user_version` counts how many ran, each runs in its own transaction. Never edit a shipped one; append.
- `PRAGMA foreign_keys = ON` per connection (SQLite's default is off), so `ON DELETE CASCADE` removes a project's folders, calls and messages. `journal_mode = WAL` for reads during writes.
- rusqlite 0.41 has no `ToSql`/`FromSql` for `usize`; use `i64` for integers.
- Timestamps are `INTEGER` milliseconds since the epoch (`db::now_ms`), which JS reads as `new Date(ms)`.

## Dialogs

- `tauri-plugin-dialog` 2.8, added with `tauri add dialog` (crate, npm package, `.plugin(...)` in lib.rs). It does not add a capability: we grant only `dialog:allow-open` to the main window, for the folder picker (`open({ directory: true, multiple: true })`, which resolves to `string[] | null`).

## Icons

`just app icon` rebuilds every icon. Checked 2026-11-03 with Xcode 27.2 (actool 27.2, bundle-version 25408), tauri-cli 2.12.4 (tauri-bundler 2.10.4), macOS 27.

- **macOS 26+: `Claudible.icon`** (`src-tauri/icons/Claudible.icon`, the Icon Composer format) holds light, dark and tinted looks. It is a folder: `icon.json` plus `Assets/1-bubble.svg` and `Assets/2-eyes.svg` (the Paper artboards `icon-composer-1-bubble`, `-2-eyes`, 1024 canvas). Open it in Icon Composer (`/Applications/Xcode.app/Contents/Applications/Icon Composer.app`) to view or edit it.
- **The `icon.json` format** isn't published by Apple. We followed real files saved by Icon Composer (fixtures and reference in github.com/peterpoliwoda/icon-composer-template) and Apple's guide (developer.apple.com, "Creating your app icon using Icon Composer": 1024 x 1024 canvas for Mac, up to four groups, SVG layers). What we use: top-level `fill-specializations` (default and `dark`), `groups` (the first group draws in front, confirmed in the compiled render), per-layer `fill-specializations` with `dark` and `tinted` entries, `glass`, group `lighting` (`combined` lights the bubble as one shape), `specular`, `blur-material`, `shadow` (`layer-color` is the chromatic shadow), `translucency`, and `supported-platforms: {"squares": ["macOS"]}`. Fills are `{"linear-gradient": [top, bottom], "orientation": {"start": {"x": 0.5, "y": 0}, "stop": {"x": 0.5, "y": 1}}}` for a lit, glossy look; flat `solid` or `automatic-gradient` fills read matte. Colours are strings like `srgb:0.90980,1.00000,0.22745,1.00000`.
- **actool 27.2 rejects `color-space-for-untagged-svg-colors`** ("The data couldn't be read because it isn't in the correct format", found by removing fields one at a time), so ours leaves it out.
- **`tauri build` can't compile a `.icon` here.** With `Claudible.icon` in `bundle.icon`, the bundler's actool step fails with "Bad file descriptor" and "Failed to create a catalog from the Icon Studio document" (reproduced 2026-11-03). This is tauri-apps/tauri#16386 (open, untriaged): since Xcode 27 actool hands the work to a persistent `ibtoold` daemon, which breaks when the bundler spawns actool. tauri-bundler 2.10.4 has no workaround for it.
- **Our workaround** (the one shipped in the issue): `app/scripts/compile-app-icon.sh` kills `ibtoold`, runs `xcrun actool ... --app-icon Claudible --include-all-app-icons --target-device mac --platform macosx --minimum-deployment-target 12.0` with stdin from `/dev/null`, retries up to three times, and writes `src-tauri/icons/Assets.car` (checked in). `bundle.macOS.files` copies it to `Contents/Resources/Assets.car`, `src-tauri/Info.plist` sets `CFBundleIconName = Claudible`, and the `.icon` stays out of `bundle.icon`. Re-run `just app icon` after changing the `.icon`. Drop the workaround once #16386 is fixed: put `icons/Claudible.icon` in `bundle.icon` and remove the script, the file entry and the plist key.
- **Older macOS, Windows, Linux:** `tauri icon` on `src-tauri/icons/app-icon.png` (the Paper `app-icon` artboard, 1024 with an 824 tile) writes icon.icns, icon.ico and the PNGs; the recipe deletes the `android/` and `ios/` sets it also writes. The bundle keeps `CFBundleIconFile = icon.icns`, which macOS before 26 uses.
- Verified in the built `Claudible.app` (7.8 MB): both `Assets.car` and `icon.icns` in Resources, both plist keys set; the icon macOS resolves for the bundle is the `.icon` rendition (rounded square, no plate).

## DMG window

- `bundle.macOS.dmg` sets `background`, `windowSize` (default 660 x 400), `appPosition` and `applicationFolderPosition` (v2.tauri.app/distribute/dmg). Ours: the Paper `dmg-background` artboard, app at (180, 200), Applications at (480, 200), where its artwork expects them.
- The background is `icons/dmg-background.tiff`, a multi-resolution TIFF made by `tiffutil -cathidpicheck` from the 1x (660 x 400) and 2x (1320 x 800) PNG exports, so Finder shows it sharp on Retina. `just app icon` rebuilds it. The bundler copies it into the volume's `.background/` and writes the layout to `.DS_Store` (checked in the built DMG, 2026-11-03).
- Finder draws the icon labels in the system's colour, not the background's, so check that "Claudible.app" and "Applications" read on the light background in dark mode.

## Dock icon in dev

- `tauri dev` has no app bundle, so on macOS Tauri sets the Dock icon at startup with `NSApplication.setApplicationIconImage`, from the first `.icns` in `bundle.icon` (else `icons/icon.png`) (`tauri` 2.12.5 `app.rs`, `RunEvent::Ready`; `tauri-codegen` 2.7.4 `context.rs`).
- On macOS 26 the Dock showed our icon on a light rounded plate (owner, 2026-11-03). That matches macOS 26 putting older-format icons whose shape doesn't match its mask on a plate. The bundle fixes it with `Assets.car` (see Icons). `tauri dev` still sets the Dock icon from icon.icns, so dev may keep the plate; the built app is the one to judge.

## Toolchain

- Rust 1.99.1 and bun 1.4.4, pinned in `mise.toml`. macOS also needs the Xcode Command Line Tools.
- `cargo clippy -- -D warnings` and `cargo fmt --check` gate the Rust core; `tsc --noEmit` and Biome gate the frontend (`just app check`); see [frontend-notes.md](frontend-notes.md).
