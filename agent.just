# The voice agent (agent/): LiveKit Agents, Gemini 3.8 Live, Claude Code over ACP.
#
# Typical use:
#     just agent install        resolve the Python dependencies (uv)
#     just agent console        talk to the agent in the terminal
#     just agent check          lint, types and tests, before every commit
#
# Set the console call's project in agent/.env (CLAUDE_PROJECT, CLAUDE_FOLDERS).

# List the agent recipes
default:
    @just --unsorted --list agent

# Install the Python dependencies and build the ACP adapters
[working-directory: 'agent']
install: adapters
    uv sync

# Build each ACP adapter into one program in adapters/bin, run by path so it never depends
# on PATH or a JS runtime. Optional packages hold the agents' own bundled binaries, which
# the adapters don't need: they run the user's install.
[working-directory: 'agent/adapters']
adapters:
    #!/usr/bin/env bash
    set -euo pipefail
    bun install --frozen-lockfile --omit optional
    for adapter in claude-agent-acp codex-acp; do
      bun build --compile --minify "node_modules/@agentclientprotocol/$adapter/dist/index.js" --outfile "bin/$adapter"
    done

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

# Lint and check formatting
[group('check')]
[working-directory: 'agent']
lint:
    uvx ruff check .
    uvx ruff format --check .

# Format the code and apply safe lint fixes
[group('check')]
[working-directory: 'agent']
fmt:
    uvx ruff format .
    uvx ruff check --fix .

# Type-check (must report 0 errors and 0 warnings)
[group('check')]
[working-directory: 'agent']
typecheck:
    uvx basedpyright .

# Everything a change must pass: lint, types, tests
[group('check')]
check: lint typecheck test
