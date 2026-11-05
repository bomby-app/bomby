# The desktop app (app/): Tauri v2. A React frontend (app/src, built by Vite) runs in the
# OS webview; a Rust core (app/src-tauri) owns the native window and talks to the OS.
#
# Typical use:
#     just app install          resolve the frontend dependencies (bun)
#     just app dev              run the app with hot reload
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

# Run the app with hot reload: Vite serves the frontend, cargo builds and opens the window
[group('run')]
[working-directory: 'app']
dev: livekit-server
    bun run tauri dev

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
    bun run tauri build {{ args }}

# Format-check, lint and type-check the frontend (Vite+: Oxfmt, Oxlint, tsgolint) and the Rust core (clippy, rustfmt); warnings fail
[group('check')]
[working-directory: 'app']
lint: livekit-server
    bun x vp check --deny-warnings
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
    cargo fmt --manifest-path src-tauri/Cargo.toml --check

# Format both halves and apply the frontend's safe lint fixes (Vite+), then rustfmt
[group('check')]
[working-directory: 'app']
fmt:
    bun x vp check --fix
    cargo fmt --manifest-path src-tauri/Cargo.toml

# Rebuild the app icons and the DMG background from the files in src-tauri/icons (see docs/tauri-notes.md#icons)
[working-directory: 'app']
icon:
    scripts/compile-app-icon.sh
    bun tauri icon src-tauri/icons/app-icon.png
    rm -rf src-tauri/icons/android src-tauri/icons/ios
    tiffutil -cathidpicheck src-tauri/icons/dmg-background.png src-tauri/icons/dmg-background@2x.png -out src-tauri/icons/dmg-background.tiff

# Add shadcn or Agents UI components, e.g. `just app add dialog`
[working-directory: 'app']
add +components:
    bun x shadcn add --yes {{components}}

# Run the Rust core's unit tests, and check the TypeScript types generated from its structs are current
[group('check')]
[working-directory: 'app']
test: (cargo-test "src-tauri/target/ts-rs")
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

# Everything a change must pass: format, lint and types for both halves, tests
[group('check')]
check: lint test
