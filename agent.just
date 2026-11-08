# The voice agent (agent/): LiveKit Agents, Gemini 3.8 Live, OpenAI GPT-Live or Rime Prism, coding agents over ACP.
#
# Typical use:
#     just agent install        resolve the Python dependencies (uv)
#     just agent console        talk to the agent in the terminal
#     just agent check          lint, types and tests, before every commit
#
# Set the console call's project in agent/.env (BOMBY_PROJECT, BOMBY_FOLDERS,
# BOMBY_INSTRUCTIONS).

# List the agent recipes
default:
    @just --unsorted --list agent

# Install the Python dependencies and build the ACP adapters
[working-directory: 'agent']
install: adapters
    uv sync

# Each adapter is one program in adapters/bin, run by path so it never depends on PATH or
# a JS runtime. Optional packages hold the agents' own bundled binaries, which the adapters
# don't need: they run the user's install.

# Build each ACP adapter into one program in adapters/bin
[working-directory: 'agent/adapters']
adapters:
    #!/usr/bin/env bash
    set -euo pipefail
    bun install --frozen-lockfile --omit optional
    for adapter in claude-agent-acp codex-acp; do
      bun build --compile --minify "node_modules/@agentclientprotocol/$adapter/dist/index.js" --outfile "bin/$adapter"
    done

# docs/decisions/ship-the-agent-and-adapter-as-sidecars.md. LiveKit's native library and
# plugins, and the Gemini SDK's data files, aren't found by import analysis.

# Freeze the agent with PyInstaller into one folder for the app to ship (agent/dist/bomby-agent)
[group('build')]
[working-directory: 'agent']
freeze:
    uv run --group freeze pyinstaller bundle.py --name bomby-agent --onedir \
      --noconfirm --clean --log-level WARN --specpath build \
      --collect-all livekit --collect-submodules livekit.plugins --collect-data google.genai \
      --add-data "$PWD/prompts:prompts"

# Sign the frozen agent with the Developer ID in APPLE_SIGNING_IDENTITY, for notarization
[group('build')]
[working-directory: 'agent/dist/bomby-agent']
sign:
    #!/usr/bin/env bash
    # Hardened runtime and a secure timestamp, as notarization requires. Tauri signs only its
    # own binaries, not the files it bundles (docs/tauri-notes.md#bundling-the-agent). No
    # entitlements: everything the agent loads is signed with the same Team ID.
    set -euo pipefail
    : "${APPLE_SIGNING_IDENTITY:?set it to the Developer ID Application identity}"
    sign() { codesign --force --sign "$APPLE_SIGNING_IDENTITY" --options runtime --timestamp "$1"; }
    # The libraries first, the program last (a signature covers what the program loads).
    # Symlinks point at files signed here.
    count=0
    while IFS= read -r -d '' file; do
      if [[ $(file -b "$file") == Mach-O* ]]; then
        sign "$file" >/dev/null 2>&1 || sign "$file"
        count=$((count + 1))
      fi
    done < <(find _internal -type f -print0)
    sign bomby-agent
    echo "Signed bomby-agent and $count libraries"

# Check a frozen agent runs: the probe, a job process, and stopping with the app (default: agent/dist)
[group('check')]
[working-directory: 'agent']
check-frozen program="dist/bomby-agent/bomby-agent":
    uv run --no-project python check_frozen.py {{ program }}

# Talk to the agent by voice in the terminal (no app or LiveKit server needed)
[group('run')]
[working-directory: 'agent']
console:
    lk agent console

# Type to the agent instead of talking
[group('run')]
[working-directory: 'agent']
console-text:
    lk agent console --text

# Console with raw Gemini Live messages dumped to the log
[group('run')]
[working-directory: 'agent']
console-debug:
    LK_GOOGLE_DEBUG=1 lk agent console

# Run against LiveKit (LIVEKIT_* in agent/.env) with hot reload, for the app
[group('run')]
[working-directory: 'agent']
dev:
    # Python directly: `lk agent dev` would use the lk CLI's selected project instead.
    uv run python agent.py dev

# Run the tests, e.g. `just agent test -k steer`
[group('check')]
[working-directory: 'agent']
test *args:
    uv run pytest {{ args }}

# What Settings and the splash need before a call (voice_providers/catalogue.py,
# extensions/catalogue.py); the core embeds them, so they're committed and builds never run
# Python for them.

# Write the voice providers' catalogue the app embeds (app/src-tauri/voice-providers.json) from their definitions
[working-directory: 'agent']
providers:
    uv run python -m voice_providers.catalogue write ../app/src-tauri/voice-providers.json

# Check the app's voice providers' catalogue is current with their definitions
[group('check')]
[working-directory: 'agent']
providers-current:
    uv run python -m voice_providers.catalogue check ../app/src-tauri/voice-providers.json

# Write the extensions' catalogue the app embeds (app/src-tauri/extensions.json) from their definitions
[working-directory: 'agent']
extensions:
    uv run python -m extensions.catalogue write ../app/src-tauri/extensions.json

# Check the app's extensions' catalogue is current with their definitions
[group('check')]
[working-directory: 'agent']
extensions-current:
    uv run python -m extensions.catalogue check ../app/src-tauri/extensions.json

# Lint and check formatting
[group('check')]
[working-directory: 'agent']
lint:
    uv run ruff check .
    uv run ruff format --check .

# Format the code and apply safe lint fixes
[group('check')]
[working-directory: 'agent']
fmt:
    uv run ruff format .
    uv run ruff check --fix .

# Type-check (must report 0 errors and 0 warnings)
[group('check')]
[working-directory: 'agent']
typecheck:
    uv run basedpyright .

# Everything a change must pass: lint, types, tests, and the app's catalogues current
[group('check')]
check: lint typecheck test providers-current extensions-current
