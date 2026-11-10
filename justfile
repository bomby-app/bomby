# Bomby: the voice agent (agent/) and the desktop app (app/).
# Each part has its own module: `just agent`, `just app` and `just livekit` list their recipes.
# See docs/AGENTS.md.

# The voice agent. See agent.just.
mod agent

# The desktop app. See app.just.
mod app

# The LiveKit server the app bundles, built from source. See livekit.just.
mod livekit

# List the recipes
default:
    @just --list --unsorted

# Install the tools pinned in mise.toml and every part's dependencies, the ACP adapters included
install: tools agent::install livekit::build app::install

# Install the tools pinned in mise.toml
tools:
    mise install

# Everything a change must pass, in every part
check: agent::check app::check lint-workflows lint-docs

# Lint the GitHub workflows: actionlint for mistakes, zizmor for security
[group('check')]
lint-workflows:
    uvx --from actionlint-py@1.7.12.25 actionlint
    uvx zizmor@1.31.1 --offline .github/workflows

# Check every link and anchor between the repo's Markdown files, offline (lychee)
[group('check')]
lint-docs:
    git ls-files -z '*.md' | xargs -0 lychee --offline --include-fragments --no-progress

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
    echo 'AGENT_NAME=bomby' >> "$starter/.env.local"
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
