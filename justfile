# claude-livekit: the voice agent (agent/) and, soon, the desktop app (app/).
# Each part has its own module: `just agent` lists the agent's recipes.
# See docs/README.md.

# The voice agent. See agent.just.
mod agent

# List the recipes
default:
    @just --list --unsorted

# Install the tools pinned in mise.toml (lk, claude-agent-acp) and every part's dependencies
install: tools agent::install

# Install the tools pinned in mise.toml
tools:
    mise install

# Everything a change must pass, in every part
check: agent::check
