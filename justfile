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
