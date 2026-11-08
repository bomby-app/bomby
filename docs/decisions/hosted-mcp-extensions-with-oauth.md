# Zapier and Composio as hosted MCP extensions, signed in with OAuth

Status: accepted, 2026-11-09

## Context

The owner wants Bomby to act in the user's other apps (mail, calendar, Slack and so on). Letting the user add any MCP server (stdio, SSE, HTTP, each with its own keys and logins) means a server editor, a secret for each server and one sign-in flow per server. Zapier and Composio each put thousands of apps behind one hosted MCP server, and the user connects their apps on the vendor's side (owner, 2026-11-09).

The owner prefers signing in over pasting keys (2026-11-09). Both servers speak standard MCP authorization, checked 2026-11-09 ([notes](../mcp-notes.md)): protected resource metadata, an authorization server with dynamic client registration, PKCE S256 and public clients, which accepted a loopback redirect. Zapier's docs only promise OAuth to clients on its list. Its registration endpoint accepted Bomby anyway, so the sign-in itself is the test.

Composio's tokens come from WorkOS, whose access tokens last minutes, so a long call outlives its first token. The worker starts once per app run, not per call, so a token in its environment would go stale.

## Decision

- **One extension per vendor**, `zapier` and `composio`, both off by default. Both are `HostedMcp` extensions (`agent/extensions/hosted_mcp.py`): a fixed MCP URL, a note for the instructions, the server's tools as one `MCPToolset`, and `open_link` for the sign-in links their tools hand back. The catalogue carries what the core needs for each one: the MCP URL, the page where the user manages their apps, and the hosts `open_link` may open.
- **The core signs in** (`app/src-tauri/src/extensions/oauth.rs`), following the MCP authorization spec: it reads the server's protected resource metadata and its authorization server's metadata, registers Bomby as a public client with a redirect to `127.0.0.1` on a port it has just bound, opens the sign-in page in the browser with PKCE and the `resource` parameter, and swaps the code for tokens. The grant (client id, token endpoint, access and refresh tokens, expiry, the account's email when the ID token has one) goes into the keychain entry with the other keys.
- **Settings, Extensions holds each one's own settings**, under its row when it's on, the way Settings, Voice keeps a provider's key under it (owner, 2026-11-09): Connect, then "Connected as …" with a link to the vendor's page and Disconnect. Each row shows the vendor's logo (owner, 2026-11-09).
- **A call has a hosted MCP extension only once it's connected.** One that's on but not connected is left out, so the voice model never gets tools that can't work.
- **The worker gets tokens from the core over a local socket, when it needs them.** The core listens on a Unix socket in a folder only the user can open, and gives the worker its path and a random secret for the run in its environment (`BOMBY_TOKENS`, `BOMBY_TOKENS_SECRET`). The worker asks for an extension's token as a call starts and again when it's about to expire or the server answers 401. The core refreshes it with the refresh token, one refresh at a time, and saves the new grant. The page never sees a token.

## Why

- **Hosted servers over a general MCP editor first.** One sign-in gives the user thousands of apps, with no commands, keys or server list to write. The OAuth code is standard MCP, so a later "your own MCP servers" extension reuses it for any remote server that signs in this way.
- **OAuth in the core, not the worker.** The worker exists only while the app runs, and Connect happens in Settings with no call. The core already owns the keychain, and refresh tokens rotate, so one owner (the core) refreshes them and no two refreshers race.
- **A local socket, not the job's metadata or the page.** Metadata and RPC travel through the LiveKit server, which is the user's LiveKit Cloud when they use one, and the page must never get a secret back from the core ([decision](credentials-in-the-os-keychain.md)). A token in the worker's environment would go stale within a call. The socket stays on the Mac: the folder's permissions keep other users out, and the secret keeps out the user's other programs, the coding agents included (their environment drops both variables, `APP_KEYS`).
- **A loopback redirect, not a `bomby://` link.** It works in dev builds and needs no URL scheme registered with macOS (RFC 8252, section 7.3). Registering again on each Connect gives the exact redirect, port and all, that strict servers require.
- **`open_link`, limited to the vendor's hosts.** Composio answers a first use of an app with a link to sign in to it. The voice model can't usefully speak a URL, so it asks the app to open it. The agent and the core both check the host, so the tool can't open anything else.

## Consequences

- New dependencies: `livekit-agents[mcp]` (the `mcp` SDK, `httpx2`) in the agent, and `reqwest`, `tokio`, `sha2` and `base64` in the core.
- A token travels only between the core and the worker on the same Mac. The worker keeps it in memory for the call.
- If a vendor turns Bomby's client away at sign-in (Zapier's list), Connect fails with the vendor's message. A connection token field would be the fallback, at the cost of a key to paste.
- A refresh that fails (revoked on the vendor's side) leaves the extension out of the next call and marks it Disconnected in Settings, so the user connects again.
- Each tool call costs the user on their vendor plan (Zapier counts two tasks per call).
- Results reach the voice model as the server sends them (JSON text), and a slow server delays the start of a call while its tools load.
