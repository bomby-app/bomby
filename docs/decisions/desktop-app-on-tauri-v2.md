# Desktop app on Tauri v2

Status: Accepted, 2026-11-03

## Context

The app needs a small, lean, cross-platform binary that runs the LiveKit React UI (Agents UI) and makes WebRTC calls. Options weighed: Tauri v2 (Rust) and Wails v3 (Go). Electron is out on footprint. Who writes the code doesn't matter; the agent writes it.

Checked 2026-11-03:

- Both use the OS web engine (WKWebView, WebView2, WebKitGTK), so both stay small; Rust binaries are a little smaller.
- Tauri v2 has been stable since late 2024 with a large plugin set (sidecars, store, SQL, updater, deep links) and a capability-based security model. Wails v3.0.0 had just been released, with a new weekly cadence.
- macOS and Windows: WebRTC works in both. macOS needs `NSMicrophoneUsageDescription` in `Info.plist` (Tauri issue #10898). Wails v3 has a built-in cross-platform media permission API.
- Linux: WebKitGTK builds generally ship without WebRTC, which hurts both equally (Tauri discussion #8426).
- Only Tauri has a real way out on Linux: LiveKit's Rust SDK can run the call natively in the Tauri core.

## Decision

Tauri v2, with a React (Vite) frontend using LiveKit Agents UI components. The official starter is Next.js; we use its components, not its server routes. The Tauri core stores projects and creates LiveKit tokens.

## Consequences

- Rust toolchain via mise (`mise use rust`), project-local.
- Mic permission is set in `Info.plist` and tested early on macOS.
- Linux voice needs the native Rust SDK path if Linux becomes a target.
