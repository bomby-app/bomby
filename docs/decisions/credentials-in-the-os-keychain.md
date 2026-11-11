# Credentials in the OS keychain

Status: accepted, 2026-11-03

## Context

The app needs the LiveKit server URL, API key and API secret to mint call tokens. The owner enters them once in Settings. The secret can sign tokens for the whole LiveKit project.

## Decision

- The core keeps them in the OS secure store (Keychain, Credential Manager, Secret Service) through the `keyring` crate, as one entry.
- The page can save, replace or remove them, and can see the URL, the key and whether a secret is saved. The secret never comes back to the page.
- The settings window may call the credentials commands, and so may the main window, for the first-run splash's keys step (`capabilities/*.json`).
- The same entry holds the voice and Zep keys, the hosted extensions' sign-ins, and any coding agent's keys the user saves in Settings, Agents, by agent id and environment variable; the agent commands (`agent_keys`, `save_agent_key`, `clear_agent_key`) are the settings window's only ([agent-keys-through-the-environment.md](agent-keys-through-the-environment.md)).

## Why

- A secret in a JSON file (the `store` plugin) or in localStorage is readable by anything that reads the disk or the webview; the keychain is encrypted and per app.
- Keeping the secret in the core means token minting stays in Rust, and a bug in the page can't leak it.

## Consequences

- The agent still reads its own `LIVEKIT_*` from `agent/.env`. When the app starts the agent itself, it passes them from here, with the coding agents' keys in `BOMBY_AGENT_KEYS`, which the agent hands each coding agent only its own share of.
- Dev builds may see a keychain prompt after a rebuild (see [tauri-notes.md](../tauri-notes.md#credentials)).
