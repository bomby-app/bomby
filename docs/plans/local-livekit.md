# Plan: LiveKit on this Mac, next to LiveKit Cloud

Status: draft, 2026-11-05. Not started; waiting on open PRs. One PR when it starts. This file is a working plan: when the PR lands, its lasting parts become the decision record and notes listed under [Docs](#docs-in-the-same-pr), and this file is deleted.

## Goal

Add a second way to run a call's LiveKit server: a `livekit-server` that ships inside Bomby and runs on the user's Mac. LiveKit Cloud (or any LiveKit server the user brings) stays as the other option.

- The user picks one on the first-run splash and can change it in Settings.
- The core starts, supervises and stops the local server, mints tokens for it, and points the agent at it.
- The agent turns Cloud-only features on or off for the server it's on: today that's Krisp noise cancellation.

Why: local mode means one key to set up (Gemini) instead of two accounts, call audio never leaves the Mac except to Gemini, latency drops because the media hop to a Cloud edge and back is gone, and there are no LiveKit quotas. Cloud stays for people who want its extras (noise cancellation, observability, the dashboard).

## What the research found

Checked 2026-11-05. The sources are in the [appendix](#appendix-sources); these facts go into `docs/livekit-notes.md` with their versions.

### The server

- **License.** Apache-2.0 (`livekit/livekit`). We can ship it; include its LICENSE in the app.
- **No macOS binaries are published.** v1.13.11 (2026-10-25) has only linux and windows assets; `.goreleaser.yaml` builds `goos: linux, windows`. Homebrew builds macOS from source: `go build ./cmd/server` from the tag's tarball, with a pinned sha256. We do the same.
- **Build.** `go.mod` needs Go 1.26.0. It has `replace` directives (pion webrtc, dtls, ice forks), so `go install ...@version` won't work: build from a checkout or tarball. `CGO_ENABLED=0` (goreleaser), so it's one static binary with no dylibs to sign.
- **Size.** linux/arm64 tar.gz is 17.5 MB, so darwin/arm64 will likely be about 45-55 MB on disk stripped (`-ldflags "-s -w" -trimpath`) and about 18 MB more in the DMG and the update archive. Measure it in the spike.
- **No Redis needed.** Without `redis:` it runs single-node, which is everything we need.
- **Config without files.** `--config-body` or env `LIVEKIT_CONFIG` takes the YAML; `--keys` or env `LIVEKIT_KEYS` takes `key: secret`. Through the environment, neither lands on disk or shows in `ps`.
- **Keys.** Outside dev mode the secret must be 32+ characters (`ValidateKeys`). We don't use `--dev`: it turns on debug logs and `/debug/pprof` and falls back to `devkey`/`secret`.
- **Ports** (defaults): signal and API on TCP 7880 (`port`), ICE/TCP 7881 (`rtc.tcp_port`), ICE/UDP 50000-60000, or one muxed `rtc.udp_port`. `bind_addresses` controls the signal listener.
- **Readiness.** `GET /` on the signal port returns `OK` (Homebrew's formula test).
- **IP discovery skips loopback.** With no `node_ip`, it advertises the Mac's LAN IP and uses loopback only when there's no other address (`mediatransportutil/pkg/rtcconfig/ip.go`). `rtc.node_ip`, `rtc.enable_loopback_candidate` and `rtc.ips.includes` / `rtc.interfaces.includes` choose what gets advertised. An open-source local voice-agent project runs a managed server with `node_ip: 127.0.0.1` and UDP mux 7882, and browsers on the same machine connect to it.
- **Agent dispatch from the token works on the OSS server.** `RoomConfiguration.agents` is handled in `pkg/service/roomallocator.go` and `roommanager.go`, with a test in `test/agent_test.go`. Bomby's dispatch (`calls.rs::token`) needs no change.

### What only LiveKit Cloud has (from the docs' self-hosted vs Cloud table)

| Feature | Bomby uses it? | Local mode |
| --- | --- | --- |
| Krisp noise cancellation (agent-side NC, VIVA voice isolation) | Not yet; added in this PR for Cloud | Off. The WebRTC `noiseSuppression` and `echoCancellation` in the webview still run in both modes |
| ai-coustics enhancement | No | Would work with the user's own ai-coustics key; out of scope |
| Agent observability (recordings, traces) | No (follows the Cloud project's setting) | Off: `_observability_url` is `None` unless the host is `*.livekit.cloud` / `*.livekit.run` (`livekit/agents/job.py`, 1.8.10) |
| LiveKit Inference, turn detector, adaptive interruption | No (Gemini Live does turns) | n/a |
| Token revocation, dashboard, analytics | No | n/a |

Cloud pricing: background noise suppression (Krisp NC) is included on every plan with no minute cap. Voice isolation (Krisp VIVA) includes 100 minutes on Build, then it's paid ([pricing](https://livekit.com/pricing), `lk docs pricing-info`). The docs say not to stack frontend Krisp on top of agent-side Krisp; standard WebRTC suppression can stay on.

### Signing and bundling

- Tauri signs `bundle.externalBin` sidecars with hardened runtime and the app's entitlements, before the app, inside out (`crates/tauri-bundler/src/bundle/macos/app.rs` and `sign.rs`, tauri-cli 2.12.4). The agent folder needed `just agent sign`; the server binary doesn't.
- A sidecar is named with the target triple in the source tree (`binaries/livekit-server-aarch64-apple-darwin`) and lands in `Contents/MacOS/livekit-server`.

## Design

### The two modes

| | This Mac (default for new users) | LiveKit Cloud / your server |
| --- | --- | --- |
| Server | Bundled `livekit-server`, run by the core | The user's URL |
| Keys | Made by the core for each run, in memory only | The user's, in the keychain (as today) |
| Setup | Nothing | Paste URL, key, secret (as today) |
| Noise cancellation | WebRTC's, in the webview | WebRTC's, plus Krisp NC in the agent when the host is LiveKit Cloud |

"Cloud" mode keeps accepting any `ws://` / `wss://` server, as today. So the agent decides on Cloud features by whether the URL is LiveKit Cloud, not by the mode: a self-hosted remote server is "your server" mode with no Krisp. (This refines what I suggested earlier, an explicit mode env var: the URL check is LiveKit's own `is_cloud`, which also covers self-hosted remote servers correctly.)

### The setting

- `settings` table key `livekit_server`: `local` or `cloud` (`settings.rs`, the same pattern as `voice`).
- **Existing installs:** with no saved value, saved Cloud keys mean `cloud` and none means `local`. Nobody is moved off Cloud silently.
- Changing it is refused during a call. Reuse the call registry `updates.rs` keeps (`open_call` registers, `end_call` forgets) so it's one source of truth. It applies to the next call.
- Switching to `cloud` keeps the local keys; switching to `local` keeps the saved Cloud keys, so switching back costs nothing.

### Core: `local_server.rs` (new)

Built like `agent.rs`'s `AgentWorker`, sharing its process code.

- **`LocalServer::ensure() -> LocalEndpoint { url, api_key, api_secret }`.** Starts the server if it isn't running, or if it died, and returns where it is. Called from `open_call` before `worker.ensure` in local mode, so the server starts lazily on the first call, as the worker does. It starts in well under a second, which the spike will confirm. Warming it at launch is an option if the first call feels slow.
- **Keys.** Generated per run: key `bomby`, a secret of 48 random characters from the OS RNG (`getrandom`). Nothing is persisted, so there's no keychain entry and no prompt. Restarting the server restarts the worker anyway, because `WorkerConfig` includes the keys and URL.
- **Ports.** Ask the OS for a free TCP port (signal) and a free UDP port (media mux) by binding `127.0.0.1:0` and releasing them. On a bind failure at start, retry once with new ports. No fixed ports, so nothing clashes with a `livekit-server --dev` the user runs themselves.
- **Config** (passed in `LIVEKIT_CONFIG`, keys in `LIVEKIT_KEYS`; the spike confirms each line):

  ```yaml
  port: <tcp>
  bind_addresses: ["127.0.0.1"]
  rtc:
    udp_port: <udp>
    tcp_port: 0                      # no ICE over TCP on loopback; check that 0 disables it
    use_external_ip: false
    node_ip: 127.0.0.1
    enable_loopback_candidate: true
    ips:
      includes: ["127.0.0.1/32"]
  logging:
    json: true
    level: info
  ```

  Fallback if WebKit or the agent can't use a loopback candidate (spike step 2): drop the `node_ip`, `ips` and `enable_loopback_candidate` lines. The server then advertises the LAN IP, which works whenever Gemini can be reached (calls need the internet anyway). The core then restarts the server between calls when the Mac's IP changes.
- **Ready.** Poll `GET http://127.0.0.1:<tcp>/` until `OK`, with a 10 s timeout. On failure, the last error line from its log, as `agent.rs::last_error` does.
- **Logs.** `livekit.log` next to `agent.log` in the app's log folder.
- **Stopping.** Its own process group, SIGTERM then SIGKILL after 5 s on app exit (`RunEvent::Exit`) and on switching to Cloud. Move `agent.rs::stop` into `process.rs` and use it for both.
- **Orphans.** Unlike the agent, the Go server has no lifeline on stdin, so a killed app (SIGKILL, crash) would leave it running. Write `livekit-server.pid` in the app data folder. On launch, if that pid is alive and is our sidecar (checked by its executable path through `libproc` / `proc_pidpath`), stop it; then delete the file. Random ports mean an orphan never blocks a new server either way.
- **The server dies mid-call.** The page sees the room disconnect and ends the call (existing path). The next `open_call` starts a new server. A crash line in its log goes to `app.log`.
- **Finding the binary.** Debug builds use `app/src-tauri/binaries/livekit-server-aarch64-apple-darwin` (built by `just install`). Release builds use `Contents/MacOS/livekit-server`, found next to `current_exe()`, the same way `agent.rs::packaged` does it. If it's missing: "This copy of Bomby is missing its LiveKit server. Install Bomby again."

### Core: changes to existing code

- `calls.rs`: `livekit_keys()` becomes `livekit_endpoint()`. It returns the local endpoint (ensuring the server) or the saved Cloud keys, by the setting. `open_call` and `call_token` use it; nothing else in token minting changes.
- `credentials.rs`: unchanged for Cloud. The local keys never go through the vault.
- `agent.rs`: `WorkerConfig` already holds a `LiveKitKeys`; local mode passes the local endpoint. The worker's env is unchanged (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`).
- New commands: `livekit_server()` returns `{ mode, localAvailable }`, and `set_livekit_server(mode)`. Both are settings-window only, plus the splash, like the credentials commands (`capabilities/`).
- `lib.rs`: manage `LocalServer`, shut it down on exit, and clean up orphans in `setup`.

### Agent

- New `agent/transport.py`: `cloud_features(livekit_url) -> CloudFeatures`, using `livekit.agents.utils.misc.is_cloud`. Its one field for now is `noise_cancellation: rtc.NoiseCancellationOptions | None`, which is `noise_cancellation.NC()` on Cloud and `None` otherwise. Every Cloud-only switch lives here and nowhere else.
- `agent.py`: `session.start(..., room_options=room_io.RoomOptions(audio_input=room_io.AudioInputOptions(noise_cancellation=features.noise_cancellation)))`. Check these names against the installed 1.8.10 source before writing them (`voice/room_io/`).
- Dependency: `livekit-plugins-noise-cancellation~=0.3` (the docs' pin; check the current version). The freeze must collect its native library: `--collect-all livekit` probably covers the `livekit.plugins.noise_cancellation` namespace package; check in the frozen build. `just agent sign` already signs every Mach-O file in `_internal`. `check_frozen.py` should import the plugin.
- NC vs VIVA: NC (background noise) is free without a cap. VIVA (voice isolation, removes other voices) has 100 free minutes a month on Build. Start with NC; VIVA is an owner call.
- Console runs (`lk agent console`) have no server, so `is_cloud("")` is false and NC is off, the same as today.
- Tests: `tests/test_transport.py` for Cloud, `.livekit.run`, self-hosted, local and empty URLs.

### Frontend

- **Splash, keys step** (`onboarding/keys-step.tsx`): the LiveKit card becomes "LiveKit, Runs on this Mac", already done, with "Use LiveKit Cloud instead" under it. Choosing Cloud shows today's Paste all card, and "Run it on this Mac instead" switches back. Gemini stays as it is. The heading copy changes: today's "I talk through your own LiveKit and Gemini, so nothing goes through us" assumes two accounts. The owner writes the new copy. The design is the owner's in Paper first, per brand.md.
- **Settings, Credentials, LiveKit** (`credentials/credentials-settings.tsx`): a two-option radio group, "On this Mac" / "LiveKit Cloud or your own server". Under Cloud, today's `LiveKitForm`, plus one line: "Adds Krisp noise cancellation on LiveKit Cloud." The radio is disabled during a call, with a reason.
- **Readiness** (`use-saved-keys.ts`, `use-call-readiness.ts`, `setup-settings.tsx`): LiveKit counts as ready when mode is local and the bundled server is there, or mode is Cloud and keys are saved. The `keys-changed` event also fires on a mode change, so every window updates.
- **Nothing changes in the call.** The page gets `serverUrl` (`ws://127.0.0.1:<port>`) and the token from `call_token` as today.

### Build and release

- `mise.toml`: pin `go` (1.26.x, the version `go.mod` needs, chosen at implementation time).
- New recipe `just app livekit-server`: download the tagged source tarball, check its pinned sha256, `CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o src-tauri/binaries/livekit-server-aarch64-apple-darwin ./cmd/server`. It skips the build if that version is already there. Pin the version and hash in the recipe, like the adapters in `agent/adapters/package.json`. The candidate today is v1.13.11; take the latest release at implementation time that is at least two weeks old.
- `just install` and `just app build` run it. Add `app/src-tauri/binaries/` to `.gitignore`.
- `tauri.conf.json`: `bundle.externalBin: ["binaries/livekit-server"]`. Ship its LICENSE under `Resources/licenses/livekit-server.txt` via `bundle.macOS.files`.
- Release workflow: add `go` to mise-action's `install_args`. After the Gatekeeper check, run the signed `Contents/MacOS/livekit-server --version` (beside `just agent check-frozen`). Building adds about 1-2 runner minutes; the workflow keeps building from scratch with no caches.
- Size: about +45-55 MB in the installed app and about +18 MB in the DMG and update download, to be measured. The agent folder is 190 MB today, for scale.

### Security

- Signal on `127.0.0.1` only; media on loopback only (verified with `lsof -i -P | grep livekit` in the spike). Nothing reaches the LAN, and macOS's application firewall never asks.
- Every connection still needs a JWT signed with a secret that exists only in the core's memory and the worker's environment. Other local processes can't join a call without it.
- The runner already strips `LIVEKIT_*` from coding agents' environments (`APP_KEYS` in `acp_client/runner.py`). `LIVEKIT_KEYS` and `LIVEKIT_CONFIG` are set only on the server's process, never the agent's.

## Spike before the PR (owner approval needed: these run servers)

`CLAUDE.md` rules out running servers and the app without the owner's go-ahead. The spike is a short, throwaway check of everything above that's marked "check":

1. Build darwin/arm64 from the pinned tag; record the binary size, compressed size, start time, idle RSS and CPU.
2. Run the server with the loopback config above. Make a call from `just app dev` (WKWebView) with the agent from source. Check that audio goes both ways and that `getStats()` shows a `127.0.0.1` candidate pair. Then repeat with Wi-Fi switched mid-call, Wi-Fi off before the call (a call is expected to fail on Gemini, not on ICE), and a VPN on.
3. The same for the Python agent's side (LiveKit's Rust FFI).
4. `lsof`: only 127.0.0.1 listeners. Check whether `tcp_port: 0` turns off ICE/TCP.
5. Compare RTT and the gap from the user's speech to the agent's first audio, local vs Cloud, over 10 turns each.
6. On Cloud: Krisp NC with Gemini Live in a noisy room, on and off. On the local server: check what the NC plugin does if it's turned on by mistake, which shows how much the gating matters.
7. A frozen and signed agent with the NC plugin loads it under hardened runtime.

If step 2 fails on loopback, use the LAN-IP fallback in [Core: `local_server.rs`](#core-local_serverrs-new) and note why in the decision record.

## Tests in the PR

- Rust unit tests: config YAML rendering, key generation (length, charset), the free-port picker, the readiness parser, the setting's default for existing installs (keys present means `cloud`), refusing a switch during a call, the orphan pid check, and `livekit_endpoint` choosing by mode.
- Python: `test_transport.py`.
- Frontend: the readiness logic, if it has tests by then.
- An opt-in E2E recipe, `just app e2e-local`, outside `just check` because it starts a server: build the server, start it, start the worker against it, mint a token with dispatch like `call_token`, join with a Python `rtc.Room` participant, and assert the agent joins and publishes. It needs no Gemini key if the job is asserted at "joined". This is the first end-to-end call test that needs no Cloud account; Cloud mode can use it later too. The owner runs it.

## Docs in the same PR

- New decision `docs/decisions/livekit-on-this-mac-or-cloud.md`: Status, Context, Decision, Consequences, with the loopback or LAN-IP result from the spike.
- `users-bring-their-own-keys-and-claude.md`: "LiveKit part superseded by livekit-on-this-mac-or-cloud.md", the same way the sidecars record marks its superseded part.
- Root `CLAUDE.md` "What and why": "their own LiveKit and Gemini keys" becomes "their own Gemini key, and LiveKit on their Mac or their own LiveKit Cloud project".
- `architecture.md`: the pieces table (the LiveKit server row becomes "Bundled, or LiveKit Cloud or self-hosted"), call step 1 (the core ensures the local server first), and a contract line for the server's config and lifecycle.
- `livekit-notes.md`: the server facts above, with versions; noise cancellation and `is_cloud`.
- `tauri-notes.md`: externalBin signing, from the bundler source.
- `releasing.md`: the Go build step, the size change, and the server check.
- `roadmap.md`: a new step row, linked to its issue.
- `brand.md` First run: the keys step's new shape, after the owner's Paper design.
- `agent/AGENTS.md`: `transport.py` is the one place for Cloud-only switches. `app/AGENTS.md`: `local_server.rs`, if it lists modules.
- `agent/.env.example`: a note that pointing `LIVEKIT_URL` at a local `livekit-server --dev` works for dev.

## Commit order inside the one PR

1. Build and bundle the server (mise, recipe, externalBin, license, workflow), with nothing using it yet.
2. Core: `local_server.rs`, the setting, `livekit_endpoint`, commands, tests.
3. Agent: `transport.py`, Krisp NC on Cloud, freeze and check, tests.
4. Frontend: splash and Settings, readiness.
5. Docs (each commit carries its own docs; this one does the decision record and the cross-doc pass).

## Owner decisions

1. **Default for new users:** open. The owner decides after trying local mode in the spike (2026-11-05).
2. **Noise cancellation model on Cloud:** open; NC recommended. Both run in the agent and both work on the free Build plan:
   - **Krisp NC** (background noise suppression) removes non-speech noise (fans, traffic, music) and keeps every voice. Included on every plan, Build too, with no minute cap. `livekit-plugins-noise-cancellation`, `noise_cancellation.NC()`.
   - **Krisp VIVA** (voice isolation) also removes other people's voices, keeping the main speaker. Paid per minute: Build includes 100 minutes a month, Ship 1,000, then $0.0012/min. What Build does past 100 minutes isn't stated in the pricing data; check before choosing it. `livekit-plugins-krisp`, `krisp.voice_isolation()`.
   - Either one goes in `room_io.AudioInputOptions(noise_cancellation=...)` and works only through LiveKit Cloud.
3. **When the local server starts:** on the first call, unless the spike shows it adds a noticeable delay to starting a call; then at launch (owner, 2026-11-05). The core can start the server and the worker together on a call, since the worker retries its connection, so the server's start (expected well under a second) overlaps the worker's.
4. **Splash and Settings design:** the owner reviews it in Paper before the frontend commit; it follows the current setup cards (owner, 2026-11-05).
5. **Spike approval:** given for when the task starts, not during planning (owner, 2026-11-05).

## Appendix: sources

- `lk docs get-page /transport/self-hosting` (self-hosted vs Cloud table), `/transport/self-hosting/local`, `/transport/self-hosting/ports-firewall`, `/transport/media/noise-cancellation`, `lk docs pricing-info`. LiveKit docs server 1.5.0 through `lk` 2.18.8, 2026-11-05.
- `github.com/livekit/livekit` at v1.13.11: `.goreleaser.yaml`, `go.mod`, `config-sample.yaml`, `cmd/server/main.go` (flags, dev-mode defaults), `pkg/config/config.go` (defaults, key length check), and release assets via `gh api repos/livekit/livekit/releases`.
- `github.com/livekit/mediatransportutil` `pkg/rtcconfig/`: `config.go` (`Validate`, port defaults), `ip.go` (loopback skipped in discovery), `webrtc_config.go` (NAT1To1 from `node_ip`, loopback candidate).
- Homebrew `Formula/l/livekit.rb` (builds from source, `GET /` returns `OK`).
- `livekit-agents` 1.8.10 installed source: `agents/job.py` (`_observability_url`), `agents/utils/misc.py` (`is_cloud`), `agents/voice/agent_session.py` (recording follows the server's setting).
- tauri-cli 2.12.4 `crates/tauri-bundler/src/bundle/macos/app.rs`, `sign.rs` (sidecar signing).
- `github.com/shaynep/local-voice-ai` `local_voice_ai/config.py` (a managed local server with `node_ip` 127.0.0.1, browsers on the host).
