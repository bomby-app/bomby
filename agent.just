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

# Install the Python dependencies
[working-directory: 'agent']
install:
    uv sync

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
    uvx basedpyright agent.py tools tests

# Everything a change must pass: lint, types, tests
[group('check')]
check: lint typecheck test
