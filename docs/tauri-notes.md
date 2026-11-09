# Tauri notes

Checked 2026-11-03/04 against Tauri 2.12.5, `tauri-codegen` 2.7.4, `wry` 0.57.1, Cargo registry sources and v2.tauri.app. Scaffolded with `create-tauri-app` 4.8.0 (`react-ts`, bun).

## App model

- `app/src` is the React/Vite webview; `app/src-tauri` is the native Rust core. The core owns files, keychain, processes and windows.
- JS calls `#[tauri::command]` functions with `invoke`; Rust pushes events. Capabilities in `src-tauri/capabilities/*.json` grant every core, plugin and app-command permission.
- `tauri.conf.json` configures identity, windows, dev server, frontend and bundles. Dev loads Vite at port 1420; build embeds `dist/` and creates native bundles.
- `main.rs` calls `bomby_lib::run()` in `lib.rs`; the split supports mobile targets.

## Microphone

- macOS requires `NSMicrophoneUsageDescription` in `src-tauri/Info.plist`. The CLI merges it into bundles and embeds it in macOS debug binaries (`tauri-codegen` `context.rs`).
- Files and folders (checked 2026-11-07, [developer.apple.com](https://developer.apple.com/documentation/bundleresources/information-property-list/nsdocumentsfolderusagedescription), macOS 10.15+): the app's first read of Desktop, Documents, Downloads, a network volume or a removable one asks the user, with the matching `NS*UsageDescription` as its text; a folder picked in an Open panel (our folder picker) counts as granted, now and later. The workspace panel reads project folders from the app itself, so `Info.plist` carries all five; `tccutil reset SystemPolicyDocumentsFolder app.bomby.desktop` resets one.
- WKWebView asks the app for capture permission, then macOS TCC asks the user. `Builder::on_permission_request` (Tauri 2.12) allows the webview request in `lib.rs`, leaving only the OS prompt.
- A dev process launched from a terminal may use the terminal's mic permission and show no prompt. The built `.app` has its own TCC identity and prompt.
- Linux WebKitGTK generally lacks usable WebRTC ([decision](decisions/desktop-app-on-tauri-v2.md)).

## Window

- macOS uses `titleBarStyle: "Overlay"` and `hiddenTitle`. The page supplies drag regions; unfocused-window dragging has a known caveat (tauri-apps/tauri#4316).
- `data-tauri-drag-region` applies only to the element, not children; use `pointer-events-none` on inner text. Requires `core:window:allow-start-dragging`.
- `trafficLightPosition` is a logical inset to the close button. Only x moves buttons directly; y also changes title-bar height (`tao` 0.37.2). Both windows use `{20, 30}`, confirmed visually on macOS 27; remeasure after OS updates.
- `getCurrentWindow().setTheme("light" | "dark" | null)` matches native appearance to the theme provider and requires `core:window:allow-set-theme`.

## Windows and commands

- `main` comes from config, hidden (`visible: false`): at startup `place_main` (`src/windows.rs`) sizes it to 80% of its screen's work area (`Monitor::work_area`, physical pixels, Tauri 2.12.5), at most 1600 × 1040 and at least the config's minimum, centers it there and shows it; a window it can't place still shows. Size and place aren't remembered between launches. `src/windows.rs` builds the other windows with `WebviewWindowBuilder`. Each loads its own Vite page listed in `build.rolldownOptions.input` (Vite 8).
- `open_settings` creates its window hidden, centers it on the main window in physical pixels, then shows it. It is async because synchronous window creation can deadlock Windows.
- `zoomHotkeysEnabled` / `zoom_hotkeys_enabled(true)` enables Cmd/Ctrl + = - 0 and needs `core:webview:allow-set-webview-zoom` on macOS/Linux.
- `windows/mount.tsx` suppresses the web context menu except in text fields and selections, preserving Cut/Copy/Paste there. Window close from JS needs `core:window:allow-close`.
- Sync commands run on the main thread; `#[tauri::command(async)]` moves blocking work such as keychain access to the async runtime.
- `build.rs` lists app commands in `AppManifest::commands`, generating `allow-<command>` permissions. Both windows get the credential commands: Settings, and the main window for the first-run splash's keys step.
- `emit` broadcasts to every webview. Commands return `Result<T, error::Error>`; the page receives the error message as a rejected promise.

## Menu bar icon

Checked 2026-11-05 against `tauri` 2.12.5 (`src/tray/mod.rs`, `src/app.rs`), `tray-icon` 0.25.1, `tauri-macros` 2.7.4 and tauri-cli's `interface/rust/manifest.rs` (GitHub, `dev`).

- The tray lives behind the `tauri` cargo feature `tray-icon`. tauri-cli rewrites the other config-driven features (`macos-private-api`, `protocol-asset`, `isolation`) from `tauri.conf.json` on every run, but leaves `tray-icon` alone, so it stays in `Cargo.toml` with no `app.trayIcon` entry. `src-tauri/src/tray.rs` builds the icon in code with `TrayIconBuilder::with_id`.
- `include_image!("icons/tray/idle.png")` decodes the PNG at compile time, relative to `CARGO_MANIFEST_DIR`, so `Image::from_bytes` and the `image-png` feature aren't needed.
- On macOS, tray-icon always draws the image 18 points tall (`platform_impl/macos/mod.rs`, `set_icon_for_ns_status_item_button`), so the templates are 36 px, 1:1 on Retina. `set_icon_with_as_template` swaps the image and template flag in one step; `set_icon` followed by `set_icon_as_template` flickers.
- `show_menu_on_left_click(true)` opens the menu on a click, as macOS menu bar items do. `set_menu` replaces the whole menu, so `set_tray_status` rebuilds it only when what it lists changes, not on every voice state.
- Menu clicks come to `on_menu_event` with the item's id. Call actions go to the main window with `emit_to("main", ...)`; the page listens with `getCurrentWindow().listen` (allowed by `core:default`). `PredefinedMenuItem::quit` quits through the normal exit, so `RunEvent::Exit` still stops the worker.
- Closing the main window hides it (`WindowEvent::CloseRequested` and `api.prevent_close()` in `on_window_event`), so the page and its call keep running. `RunEvent::Reopen` (macOS, a Dock click; `#[non_exhaustive]`) shows it again. Cmd+Q quits as usual. Check in `just app dev` that a call keeps its audio while the window is hidden: WebKit may throttle timers in a hidden page.

## Notifications

Checked 2026-11-05 against the published sources of `tauri-plugin-notification` 2.8.0 (`src/desktop.rs`; its desktop code matches 2.7.0, and 2.8.0 only adds Android options), `notify-rust` 4.18.1 and `mac-notification-sys` 0.6.15 (`objc/notify.m`), and v2.tauri.app/plugin/notification.

- The core alone uses it (`src-tauri/src/notifications.rs`, Rust API `app.notification().builder()`), so no window gets `notification:` permissions and the npm package isn't installed. The page reports finished tasks with `task_finished`.
- macOS goes through the deprecated `NSUserNotificationCenter`: mac-notification-sys swaps the process's bundle identifier for the one it's given, if LaunchServices knows an app with it (`setApplication`, `LSCopyApplicationURLsForBundleIdentifier`).
- **Dev and packaged differ.** Under `tauri dev`, `tauri::is_dev()` makes the plugin post as `com.apple.Terminal`: notifications show Terminal's name and icon and follow Terminal's setting in System Settings > Notifications, whichever terminal started the app. A built app (`just app build`, or `tauri build --debug`) posts as `app.bomby.desktop` once it has been opened from its bundle.
- **Permission.** On desktop, `permission_state` and `request_permission` always answer `Granted` and never prompt; whether macOS asks the user, and where a refusal shows, is up to macOS. Check it on the packaged app.
- **Clicks.** Once a Rust `on_action` handler is registered, each notification is shown "tracked": a thread waits for its response, and a click arrives as action `"tap"` with the notification's `extra` data (`projectId` here). Without a handler, `show()` doesn't wait.
- "Bomby isn't focused" means no window's `is_focused()`, which on macOS is `NSWindow.isKeyWindow` (`tao` 0.37.2): false for a hidden window and for every window while another app is active.

## Transparent windows and private APIs

Researched 2026-11-05 for a floating mascot window (not built). Sources: `tauri` 2.12.5 `src/lib.rs` and v2.tauri.app/release/tauri (PR tauri-apps/tauri#16166), `wry` 0.57.1 `src/wkwebview/mod.rs`, `tao` 0.37.2, Apple's App Review Guidelines and "Notarizing macOS software before distribution", tauri-apps/tauri#13070 and #2090.

- `transparent(true)` works on macOS with no flag: the `macos-private-api` feature and `macOSPrivateApi` config are no-ops since Tauri 2.12.1, because wry dropped its feature gates (#16166).
- A transparent window (or one with `background_color`) makes wry set WebKit's private `drawsBackground` key through KVC (`setValue:forKey:`). Every webview already sets the private `allowsPictureInPictureMediaPlayback` key the same way, transparent or not (`mod.rs:386`), so Bomby uses private WebKit keys today. If a macOS update removes a key, KVC raises `NSUnknownKeyException` when the webview is created.
- **Mac App Store**: guideline 2.5.1 allows only public APIs. Bomby can't go there anyway: 2.4.5(i) requires the App Sandbox, and 2.5.2 bans downloading, installing or running code, which is what Set up (bun, the adapters) and the call (the user's agents) do.
- **Developer ID**: "Notarization of macOS software is not App Review": the notary service scans for malicious content and code-signing problems. Private API use isn't checked.
- **Click-through**: a transparent webview window takes every click in its rectangle. Per-pixel pass-through won't be added (#13070, closed as a duplicate of #2090); the way is to switch `set_ignore_cursor_events` on demand. `AppHandle::cursor_position` reads `NSEvent.mouseLocation` (tao 0.37.2 `util/mod.rs`), a public API that needs no permission, so the core can poll it and turn ignoring off only over the visible shape.
- **Shortcuts**: `tauri-plugin-global-shortcut` 2.4.1 uses `global-hotkey` 0.8, which registers ordinary shortcuts with Carbon's `RegisterEventHotKey` (no Accessibility permission); only media keys use an event tap.

## Agent worker

- `src-tauri/src/agent.rs` keeps one worker per app run. The first `open_call` starts it; credential or `claude` path changes, or its death, restart it; app exit stops it.
- Both builds run the same entry, `agent/bundle.py`, with `start` (the worker) or `probe` and the metadata (setup). Debug runs it from source, `uv run python bundle.py` in `agent/`, found at build time from `CARGO_MANIFEST_DIR`. Release runs the packaged agent, `Contents/Resources/agent/bomby-agent`, found from `current_exe()` (`Contents/MacOS`), with its own folder as the working directory.
- The environment passes the LiveKit and voice provider keys (`GOOGLE_API_KEY`, `RIME_API_KEY`) and `CLAUDE_CODE_EXECUTABLE`; `child_environment` removes secrets before launching Claude.
- The worker has its own process group. Normal shutdown uses SIGTERM, five seconds, then SIGKILL.
- `BOMBY_EXIT_WITH_APP=1` plus a core-held stdin pipe ensures the worker cannot outlive the app. `agent/lifeline.py` stops the group on EOF (SIGTERM, three seconds, SIGKILL), covering crashes and Ctrl-C.
- Logs go to `agent.log` in `app.path().app_log_dir()`, rewritten per start. The page's `app_log` command writes webview audio facts to `app.log` there. Startup errors surface the worker's last JSON error. A job that crashes logs `unhandled exception while running the job task` with `room` and `exc_info` (livekit-agents 1.8.10, `ipc/job_proc_lazy_main.py`, `_on_entry_done`; seen in agent.log 2026-11-05); the core reports it as `call-agent-crashed`.

## Bundling the agent

Checked 2026-11-05 in the bundler of `@tauri-apps/cli` 2.12.4 (`crates/tauri-bundler/src/bundle/macos/app.rs`, `utils/fs_utils.rs`, `settings.rs`).

- `bundle.resources` copies each file with `fs::copy`, so a symlink becomes a second copy of its target. PyInstaller's folder has 17 symlinked libraries (PyAV's), so the agent goes in through `bundle.macOS.files` instead (`"Resources/agent": "../../agent/dist/bomby-agent"`), whose `copy_dir` recreates symlinks.
- Signing (when an identity is set) covers `bundle.macOS.frameworks`, `externalBin` sidecars and the main binary, then the `.app`. It doesn't sign files from `resources` or `macOS.files`, so the agent folder's libraries need their own signature before `tauri build`.
- `just app build` runs `just agent freeze` first. The folder is 190 MB.
- **The LiveKit server is a sidecar** (`bundle.externalBin: ["binaries/livekit-server"]`), so Tauri signs it with hardened runtime and the app's entitlements, before the app (`app.rs`, `sign.rs`). The file in the tree is named for the target (`binaries/livekit-server-aarch64-apple-darwin`) and lands as `Contents/MacOS/livekit-server`.
- **An `externalBin` must exist to compile at all**: tauri-build 2.7.4 copies each one next to the built program, also in dev (`target/debug/livekit-server`), and fails when one is missing (`copy_binaries` in `tauri-build/src/lib.rs`). So `just app lint`, `test`, `dev` and `build` run `just livekit build` first, and both dev and release builds find the server beside `current_exe()`.

## Signing and notarizing

Checked 2026-11-05 in `@tauri-apps/cli` 2.12.4 (`crates/tauri-bundler/src/bundle/macos/sign.rs`, `app.rs`, `dmg/mod.rs`; `crates/tauri-macos-sign/src/keychain.rs`) and v2.tauri.app/distribute/sign/macos. How releases use it: [releasing.md](releasing.md).

- **Identity.** `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` make Tauri import the `.p12` into a temporary keychain for the build. Without them, `APPLE_SIGNING_IDENTITY` (or `bundle.macOS.signingIdentity`) is used from the keychain search list. The workflow imports the certificate itself, because the agent is signed before Tauri runs.
- **codesign.** `codesign --force -s <identity> [--options runtime] [--entitlements <file>] <path>`, with no `--timestamp`. Hardened runtime is on by default (`bundle.macOS.hardenedRuntime`, default `true`). Every target gets the same `bundle.macOS.entitlements` file.
- **Notarizing.** With `APPLE_API_KEY`, `APPLE_API_ISSUER` and `APPLE_API_KEY_PATH` (or an `AuthKey_<id>.p8` in `~/private_keys` and similar folders), Tauri zips the app with `ditto`, submits it to `notarytool`, waits and staples it. Without credentials it only logs "skipping app notarization", so the workflow checks with `xcrun stapler validate`.
- **DMG.** The DMG is signed (unless the identity is `-`) but not notarized; the workflow notarizes and staples it with `notarytool` directly.
- **Unsigned builds.** With no identity, nothing is signed: the main binary keeps the linker's ad-hoc signature, and its designated requirement is its `cdhash`. Each rebuild is a new app to the keychain, which asks again for the saved keys; a Developer ID build is identified by its Team ID, so one Always Allow lasts across updates.
- **Mic.** Hardened runtime blocks the mic without `com.apple.security.device.audio-input` (Apple, "Audio Input Entitlement"), in `src-tauri/Entitlements.plist`.

## Updates

Checked 2026-11-05 in `tauri-plugin-updater` 2.14.0 (`src/updater.rs`, `src/config.rs`), `@tauri-apps/cli` 2.12.4 (`crates/tauri-cli/src/bundle.rs`, `helpers/updater_signature.rs`) and v2.tauri.app/plugin/updater. How releases publish them: [releasing.md](releasing.md).

- The core alone uses the plugin (`src-tauri/src/updates.rs`: `about`, `check_for_updates`, `install_update`, the `update-status` event), so no window gets `updater:` permissions and the npm package isn't installed. Development builds report `development` and never check.
- `plugins.updater` in `tauri.conf.json`: `pubkey` (the key's contents, not a path; minisign key id `CFD42E07E63E0804`), `endpoints` (HTTPS only in release; the next is tried only on a non-2xx), `requireSignedVersion`. The plugin won't start without this block.
- `latest.json`: `version`, `pub_date`, and `platforms["darwin-aarch64"]` with `signature` (the `.sig` file's contents) and `url`. The key is `{os}-{arch}`; a `{target}-{installer}` key is tried first. An update is offered when its version is greater than the app's, unless `version_comparator` says otherwise.
- **Signing updates.** The CLI signs updater bundles only when `bundle.createUpdaterArtifacts` is on, with `TAURI_SIGNING_PRIVATE_KEY` (contents or path) and `_PASSWORD`; without the key it fails ("A public key has been found, but no private key"). CLI 2.12.4 writes the app version into the signature's trusted comment, which `requireSignedVersion` checks against the announced version, so a stale `latest.json` can't downgrade anyone. Local builds leave the setting off (`tauri.release.conf.json` turns it on for releases).
- On macOS the bundle is `Bomby.app.tar.gz` next to the `.app`; `download_and_install` replaces the running bundle in place, then the app must restart. `AppHandle::request_restart` from another thread goes through `RunEvent::Exit`, so the agent worker is stopped first (tauri 2.12.5, `app.rs`).

## Finding agents

- Finder launches provide launchd's PATH, not the shell's. `src-tauri/src/agents.rs` queries the login shell once (`$SHELL -ilc`, eight-second timeout), ignores rc-file noise, then checks known install locations.
- Settings strips version prefixes from `opencode --version` and `omp --version`. Each agent's checks run on their own thread.
- Setup (provider, model, sign-in) comes from the agent's probe (`src-tauri/src/setup.rs` runs `agent/probe.py` through `agent::command`, 60-second timeout, JSON on stdout). It runs on its own thread beside the version checks, so it is part of every look ([decision](decisions/check-agent-setup-with-an-acp-probe.md)).
- `agents::Agents` in Tauri state keeps the last look. `setup` starts the first one on `tauri::async_runtime::spawn_blocking`; only one look runs at a time, and callers during it wait on a `Condvar` instead of starting another. `open_call` looks up only the programs (`usable_now`: shell and install places, no version checks), leaves out those the last look found not set up, and starts a full look in the background when they differ from what Settings shows. That look starts after any running one (which began before the programs were found) and starts from them, so a login shell that fails then still keeps them. A changed result goes to every window as the `agents-changed` event (`Emitter::emit`; `core:default` includes `core:event:default`, which allows `listen`).
- A sync `#[tauri::command(async)]` runs inside `async_runtime::spawn` on a tokio worker, not on a blocking thread (`tauri` 2.12.5 `src/ipc/mod.rs`, `respond_async`). The agent commands are `async fn` and move the look, and the model picker's listings and picks, to `spawn_blocking`; its `JoinHandle` resolves to `tauri::Result<T>`.
- See [detection decision](decisions/detect-acp-native-agents.md).

## Installing adapters

- `src-tauri/src/adapters.rs` installs the ACP adapters into `app_data_dir()/adapters` ([decision](decisions/install-adapters-on-setup.md)): bun 1.4.4 from its GitHub release zip (`curl`, checked with `shasum -a 256` against the release's SHASUMS256.txt, unpacked with `ditto -x -k`), then `bun install --frozen-lockfile --omit optional` on the embedded `agent/adapters/` lockfile (`include_str!`) and `bun build --compile` per package `bin`. Output goes to `install.log` there; each step has a five-minute limit. Measured 2026-11-04: 6 s end to end on a fast connection.
- A file `curl` downloads gets `com.apple.provenance` but no `com.apple.quarantine`, so Gatekeeper doesn't stop it, and the downloaded bun runs (macOS 27, 2026-11-04, from a terminal; recheck from the packaged app in step 7).
- `install_adapters` runs one install at a time and looks for the agents again before it resolves; the page shows one "Setting up..." state for the whole install (owner, 2026-11-05). `agent::command` passes `BOMBY_ADAPTERS` to the worker and the probe.

## Credentials

- `keyring` 4.2.0 with `v1` uses Keychain, Windows Credential Manager or Secret Service. One entry (service = app identifier, account `credentials`) stores JSON for LiveKit and Gemini.
- `credentials::Vault` reads once per run and caches in Tauri state. The page receives URL, API key and boolean secret presence, never the secrets. Each save or removal sends `keys-changed` (no payload) to every window, so the main window's Call buttons follow keys changed in Settings.
- Ad-hoc-signed dev rebuilds can trigger another macOS keychain prompt because each binary is a new trust identity. A Developer ID release keeps a stable identity.

## Storage

- `rusqlite` 0.41.1 with `bundled`, behind `Mutex<Connection>` in Tauri state. `bomby.db` lives in `app_data_dir` and is created in `Builder::setup`.
- Append-only SQL migrations run in transactions; `PRAGMA user_version` tracks them. Never edit a shipped migration.
- Enable `foreign_keys` per connection for cascades and use WAL for concurrent reads during writes.
- Use `i64`, not `usize`, for SQL integers. Timestamps are integer epoch milliseconds, read in JS with `new Date(ms)`.

## Dialogs, clipboard and links

- `tauri-plugin-dialog` 2.8.4 provides the native multi-folder picker: `open({ directory: true, multiple: true })` resolves to `string[] | null`. Only the main window has `dialog:allow-open`.
- Settings uses `tauri-plugin-clipboard-manager` 2 for Paste all and copying install commands. Scoped read/write permissions avoid WKWebView's separate Paste prompt. Ordinary paste events need no plugin permission.
- Links open in the browser through `tauri-plugin-opener` 2.7.2. `opener:default` would also allow any `http(s)`, `mailto:` and `tel:` URL and revealing files ([plugin docs](https://v2.tauri.app/plugin/opener/#default-permission)), so the main window gets only `opener:allow-open-url` scoped to the two key pages the splash links to. Each `url` entry is a `glob::Pattern` matched against the whole string the page passes (`src/scope.rs`, `matches_url`), so an exact URL allows only itself.

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
- Finder colours icon labels by the system appearance, not the picture, and the DMG script (`bundle_dmg.sh`) only sets icon and text size: no label colour, no hiding. A dark background left black labels on ink in light mode, so the owner chose the light one (2026-11-04); its labels are white in dark mode.
- On CI the DMG gets no styling: with `CI=true`, the bundler passes `--skip-jenkins` to `bundle_dmg.sh`, which skips the Finder AppleScript that sets the background, window size and icon places, unless `TAURI_BUNDLER_DMG_IGNORE_CI=true` (tauri-bundler `src/bundle/macos/dmg/mod.rs` at `@tauri-apps/cli-v2.12.4`, the installed CLI, checked 2026-11-05). The Release workflow sets it. The script needs Finder automation; if a runner refuses it, the build fails with -1743 ("the terminal needs permission to control Finder").
- One background for both appearances: Finder shows a DMG window's background picture as is in light and dark mode, with no per-appearance variant ([c-command forum](https://forum.c-command.com/t/light-and-dark-mode-background-images/11916), checked 2026-11-04). The art is exported from Paper `app assets` / `dmg-background` at 1x and 2x; `dmg-background-dark` there is the unused dark version.

## Dock icon in dev

Without a bundle, Tauri sets the Dock icon from the first ICNS in `bundle.icon` at `RunEvent::Ready`. macOS 26 may put this older-format icon on a plate; judge the built app's `Assets.car` rendition instead.

## Toolchain

Rust 1.99.1 and bun 1.4.4 are pinned in `mise.toml`; macOS also needs Xcode Command Line Tools. `just app check` runs Clippy, rustfmt, `vp check` (Oxfmt, Oxlint, types) and the Rust tests ([frontend notes](frontend-notes.md)).

## Generated types

The page's types for what the core sends come from the core's structs, generated by ts-rs 12.0.1, a dev-dependency only, so nothing ships in the app (checked 2026-11-05, `ts-rs-12.0.1/src/lib.rs`; tauri-specta was 2.0.0-rc.26 and specta 2.0.0-rc.28, still release candidates; [decision](decisions/generate-page-types-with-ts-rs.md)).

- A struct opts in with `#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "agents.ts"))]`; `cargo test` writes it to `TS_RS_EXPORT_DIR` (read at test time, lib.rs:625; default `./bindings`, which `.gitignore` covers). `just app types` writes them to `app/src/generated`, which is checked in and imported as `@/generated/...`; `just app test` writes them under `target/` and fails when they differ from the checked-in ones.
- Cargo config (`.cargo/config.toml`) is found from the directory cargo runs in, not the manifest, so one recipe both use, `cargo-test` in `app.just`, sets `TS_RS_EXPORT_DIR` and `TS_RS_LARGE_INT=number` (64-bit integers as `number`, not `bigint`).
- A type named like a TypeScript built-in would shadow it in every module that imports it, so it's renamed for the page only: `Pick` is `SettingPick` (`ts(rename = ...)`).
- ts-rs follows `rename_all`, `flatten` (fields inlined), `Option<T>` (`T | null`) and lowercase enums, but ignores serde's split `rename_all(serialize = ..., deserialize = ...)` without a warning: such a struct also needs `ts(rename_all = "camelCase")`.
- The generated files are left out of formatting and linting (`ignorePatterns` in `vite.config.ts`); types still check against them.
- What the voice agent's probe sends the core is pinned on both sides by one fixture, `agent/tests/fixtures/probe-answer.json`: written from a real answer by `agent/tests/test_probe_contract.py`, read by `reads_the_probes_answer` in `setup.rs`, which checks every field the probe sends is read, nested ones included, and comes out under the page's name.

## Streaming bytes and terminals

Checked 2026-11-07 against tauri 2.12.5 (`src/ipc/channel.rs`), `@tauri-apps/api` 2.12.4, portable-pty 0.9.0, git2 0.21.0 (libgit2 1.9.7) and notify 8.2.1 with notify-debouncer-mini 0.7.0, in `~/.cargo/registry`.

- A `Channel<InvokeResponseBody>` sending `InvokeResponseBody::Raw(bytes)` arrives in JS as an `ArrayBuffer`. A `Channel<Vec<u8>>` doesn't: `Vec<u8>` is `Serialize`, so it goes as a JSON array of numbers.
- portable-pty's `native_pty_system().openpty(size)` gives a master and a slave; `slave.spawn_command` runs the child with `setsid` and the slave as its controlling terminal, so the shell leads its own process group. Drop the slave after spawning, or reads never end. On macOS a read on the master fails with EIO once every holder of the slave is gone. `CommandBuilder::new` starts from the app's own environment, which under `just app dev` is the developer's shell's: `EDITOR=nvim` there switched zsh to vi keys before the user's zshrc ran, so after its `bindkey -e` Delete was unbound and typed "~" (`delete_deletes_in_the_users_shell`). The core clears it (`env_clear`) and passes what a terminal app opened from Finder gets (`HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `SSH_AUTH_SOCK`, the locale), launchd's `PATH` and the `TERM` variables; the login shell builds the rest. Such an app has no `LANG`, so the core sets one.
- **Commands don't keep their order.** A `#[tauri::command(async)]` runs as its own task on the async runtime's thread pool (`InvokeResolver::respond_async` → `async_runtime::spawn`, tauri 2.12.5), so a burst of calls can run in any order: one command per keystroke into a terminal arrived scrambled (`keystrokes_arrive_in_the_order_they_were_typed`, `src/workspace/terminals.rs`), which lost vim's `:wq`. A stream of commands whose order matters carries a sequence number and the core reorders (the terminal's `Inbox`).
- `Child::kill` sends SIGKILL to the shell alone; the core sends SIGHUP to its group instead, as a closing terminal window does, and only while the child is unreaped, so a reused pid is never signalled.
- git2 with `default-features = false, features = ["vendored-libgit2"]` builds libgit2 from source with no OpenSSL or SSH (only local repositories are read). `diff_tree_to_workdir_with_index` with `include_untracked`, `recurse_untracked_dirs` and `show_untracked_content` matches `git diff HEAD` plus new files; `Patch::from_diff(...).to_buf()` prints one file's patch with its `diff --git` header. `is_path_ignored` takes a path relative to the working directory.
- notify's `RecommendedWatcher` is FSEvents on macOS, recursive and cheap on big trees; dropping the debouncer stops it.
