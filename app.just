# The desktop app (app/): Tauri v2. A React frontend (app/src, built by Vite) runs in the
# OS webview; a Rust core (app/src-tauri) owns the native window and talks to the OS.
#
# Typical use:
#     just app install          resolve the frontend dependencies (bun)
#     just app dev              run the app with hot reload
#     just app dev --splash --agents=none     try a state without changing this Mac
#     just app check            format, lint, types and tests for both halves, before every commit
#     just app build            build the installable app bundle

# List the app recipes
default:
    @just --unsorted --list app

# Install the frontend dependencies (the Rust ones are fetched by cargo on build)
[working-directory: 'app']
install:
    bun install

# tauri-build won't compile the core without the bundled LiveKit server.
[private]
livekit-server:
    {{ just_executable() }} --justfile {{ justfile_directory() }}/justfile livekit build

# The flags try a state without changing this Mac (src-tauri/src/dev.rs). --signed-out runs
# every Claude Code the app starts on a new empty config folder, which Claude Code keys its
# login to, so it's signed out; your own login and ~/.claude are untouched. --no-keys keeps
# the keys in memory for the run, so the keychain's saved keys stay as they are.

# Run the app with hot reload: Vite serves the frontend, cargo builds and opens the window
[group('run')]
[working-directory: 'app']
[arg("splash", long, value="1", help="Show the first-run splash at every launch")]
[arg("agents", long, help="Find only these agents (codex,goose), or none")]
[arg("signed_out", long="signed-out", value="1", help="Run Claude Code signed out")]
[arg("no_keys", long="no-keys", value="1", help="Start with no LiveKit or voice keys, kept in memory for the run")]
dev splash="" agents="" signed_out="" no_keys="": livekit-server
    BOMBY_DEV_SPLASH={{ quote(splash) }} BOMBY_DEV_AGENTS={{ quote(agents) }} BOMBY_DEV_NO_KEYS={{ quote(no_keys) }} {{ if signed_out != "" { 'CLAUDE_CONFIG_DIR="$(mktemp -d)"' } else { "" } }} bun --bun run tauri dev

# The agent is frozen first (`just agent freeze`). With the APPLE_* variables set
# (docs/releasing.md), the agent is signed before it's bundled and Tauri signs and notarizes
# the app; without them, the build is unsigned, for testing on this Mac. Releases also pass
# `--config src-tauri/tauri.release.conf.json`, which adds the signed update bundle.

# Build the release app bundle, with the voice agent, into app/src-tauri/target/release/bundle (.app and .dmg)
[group('run')]
[working-directory: 'app']
build *args: livekit-server
    {{ just_executable() }} --justfile {{ justfile_directory() }}/justfile agent freeze
    if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then {{ just_executable() }} --justfile {{ justfile_directory() }}/justfile agent sign; fi
    bun --bun run tauri build {{ args }}

# Format-check, lint and type-check the frontend (Vite+: Oxfmt, Oxlint, tsgolint) and the Rust core (clippy, rustfmt); warnings fail
[group('check')]
[working-directory: 'app']
lint: livekit-server
    bun --bun x vp check --deny-warnings
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
    cargo fmt --manifest-path src-tauri/Cargo.toml --check

# Format both halves and apply the frontend's safe lint fixes (Vite+), then rustfmt
[group('check')]
[working-directory: 'app']
fmt:
    bun --bun x vp check --fix
    cargo fmt --manifest-path src-tauri/Cargo.toml

# Rebuild the app icons and the DMG background from the files in src-tauri/icons (see docs/tauri-notes.md#icons)
[working-directory: 'app']
icon:
    scripts/compile-app-icon.sh
    bun --bun run tauri icon src-tauri/icons/app-icon.png
    rm -rf src-tauri/icons/android src-tauri/icons/ios
    tiffutil -cathidpicheck src-tauri/icons/dmg-background.png src-tauri/icons/dmg-background@2x.png -out src-tauri/icons/dmg-background.tiff

# Add shadcn or Agents UI components, e.g. `just app add dialog`
[working-directory: 'app']
add +components:
    bun --bun x shadcn add --yes {{components}}

# Run the frontend's and the Rust core's unit tests, and check the TypeScript types generated from the core's structs are current
[group('check')]
[working-directory: 'app']
test: (cargo-test "src-tauri/target/ts-rs")
    bun --bun x vp test
    diff -r src-tauri/target/ts-rs src/generated || { echo "The generated types are out of date: run just app types"; exit 1; }

# Write the TypeScript types generated from the core's structs (ts-rs) to src/generated, where the page imports them
[group('check')]
types: (cargo-test "src/generated" "export_bindings")

# The core's tests matching `filter`, ts-rs writing the page's types into `types`
# (docs/tauri-notes.md#generated-types); 64-bit integers as numbers, never past 2^53
[private]
[working-directory: 'app']
cargo-test types filter="": livekit-server
    rm -rf {{ types }}
    TS_RS_EXPORT_DIR="$PWD/{{ types }}" TS_RS_LARGE_INT=number cargo test --manifest-path src-tauri/Cargo.toml {{ filter }}

# Check the core's dependencies against src-tauri/deny.toml: licenses we can ship, crates.io only
[group('check')]
[working-directory: 'app']
deny:
    cargo-deny --manifest-path src-tauri/Cargo.toml check licenses bans sources

# Check the core's dependencies against RustSec's advisories (needs the network; CI runs it too)
[group('check')]
[working-directory: 'app']
advisories:
    cargo-deny --manifest-path src-tauri/Cargo.toml check advisories

# Everything a change must pass: format, lint and types for both halves, tests, dependency licenses
[group('check')]
check: lint test deny
