# Claudible: the voice agent (agent/) and the desktop app (app/).
# Each part has its own module: `just agent` and `just app` list their recipes.
# See docs/README.md.

# The voice agent. See agent.just.
mod agent

# The desktop app. See app.just.
mod app

# List the recipes
default:
    @just --list --unsorted

# Install the tools pinned in mise.toml (lk, claude-agent-acp, rust, bun) and every part's dependencies
install: tools agent::install app::install

# Install the tools pinned in mise.toml
tools:
    mise install

# Everything a change must pass, in every part
check: agent::check app::check

# Talk to the agent from a browser with LiveKit's own agent starter (localhost:3000): Chrome vs Safari separates WebKit (Tauri) from React and LiveKit. Ctrl-C stops both.
[group('debug')]
web-test:
    #!/usr/bin/env bash
    set -euo pipefail
    starter=.scratch/agent-starter-react
    if [[ ! -d $starter ]]; then
      git clone --depth 1 https://github.com/livekit-examples/agent-starter-react "$starter"
    fi
    # Only the LiveKit keys from agent/.env, plus explicit dispatch to our agent.
    grep -E '^LIVEKIT_(URL|API_KEY|API_SECRET)=' agent/.env > "$starter/.env.local"
    echo 'AGENT_NAME=claudible' >> "$starter/.env.local"
    (cd "$starter" && bun install --silent)
    # Both in this terminal's process group, so Ctrl-C stops both.
    trap 'kill 0' EXIT
    # The agent straight from Python, on agent/.env's LiveKit project. `lk agent dev` would
    # register it on the lk CLI's default project instead, where this room never is.
    (cd agent && uv run python agent.py dev) &
    (cd "$starter" && bun run dev) &
    echo
    echo "Open http://localhost:3000 in Chrome, then in Safari."
    wait
