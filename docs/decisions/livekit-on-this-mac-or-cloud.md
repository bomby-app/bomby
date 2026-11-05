# LiveKit on this Mac, or the user's LiveKit Cloud

Status: accepted, 2026-11-05. Supersedes the LiveKit part of [users-bring-their-own-keys-and-claude.md](users-bring-their-own-keys-and-claude.md).

## Context

A call needs a LiveKit server between the page and the voice agent. Until now that meant the user's own LiveKit Cloud project: one more account and three more values to paste before the first call. Yet both ends of a call run on the same Mac, and the open-source server does everything Bomby uses (rooms, token dispatch, participant attributes, transcripts).

## Decision

- **Two ways to run a call's server**, chosen on the first-run splash and in Settings, Credentials (owner, 2026-11-05):
  - **This Mac**: Bomby's own `livekit-server`, bundled in the app and run by the core.
  - **LiveKit Cloud or your own server**: the URL and keys the user brings, as before.
- **The bundled server is built from LiveKit's source**, pinned by version and hash, because no macOS binary is published ([notes](../livekit-notes.md#the-bundled-server)). It ships as a Tauri sidecar, which Tauri signs.
- **It runs only on this machine.** The signal port is on `127.0.0.1` and the media ports advertise only loopback. Its keys are made fresh by the core each time it starts and live in memory only, so nothing goes in the keychain or on disk. Ports are picked free each time.
- **It starts with the first call**, like the agent worker, and runs until Bomby quits or the user switches to Cloud (owner, 2026-11-05: on the call unless that makes a call noticeably slower to start).
- **A call keeps its server.** The server, URL and keys a call opened with stay its own for every token it gets, like its agents and picks, so switching mid-call applies from the next call.
- **Cloud-only features follow the server, not the setting.** The agent turns on Krisp background noise suppression when its `LIVEKIT_URL` is LiveKit Cloud (LiveKit's own `is_cloud`), so a self-hosted server under "your own server" gets none either.
- **Existing installs keep Cloud.** Until the user chooses, an install with LiveKit keys saved stays on them; one without uses this Mac.

## Why

- One account fewer to set up: a call needs only a Gemini key and an agent.
- Call audio stays on the Mac except what goes to Gemini, and the hop to a Cloud edge and back is gone.
- Cloud stays for its extras: Krisp noise cancellation, its dashboard and observability, and calls from other devices later.

## Consequences

- The app grows by 54 MB (17.6 MB in the DMG and the update) and the build needs Go (`mise.toml`).
- A local server and the worker are two processes to supervise. The core stops the server with the app, and stops one a killed Bomby left behind the next time it starts (`local_server.rs`).
- Local calls get WebRTC's own noise suppression in the webview, not Krisp.
- The default for new users is this Mac for now; the owner settles it after trying both (2026-11-05).
