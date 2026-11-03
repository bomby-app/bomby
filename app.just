# The desktop app (app/): Tauri v2. A React frontend (app/src, built by Vite) runs in the
# OS webview; a Rust core (app/src-tauri) owns the native window and talks to the OS.
#
# Typical use:
#     just app install          resolve the frontend dependencies (bun)
#     just app dev              run the app with hot reload
#     just app check            types, Rust lint and format, before every commit
#     just app build            build the installable app bundle

# List the app recipes
default:
    @just --unsorted --list app

# Install the frontend dependencies (the Rust ones are fetched by cargo on build)
[working-directory: 'app']
install:
    bun install

# Run the app with hot reload: Vite serves the frontend, cargo builds and opens the window
[group('run')]
[working-directory: 'app']
dev:
    bun run tauri dev

# Build the release app bundle (.app and .dmg on macOS) into app/src-tauri/target/release/bundle
[group('run')]
[working-directory: 'app']
build:
    bun run tauri build

# Type-check the frontend
[group('check')]
[working-directory: 'app']
typecheck:
    bun x tsc --noEmit

# Lint the Rust core (warnings fail) and check its formatting
[group('check')]
[working-directory: 'app/src-tauri']
lint:
    cargo clippy --all-targets -- -D warnings
    cargo fmt --check

# Format the Rust core
[group('check')]
[working-directory: 'app/src-tauri']
fmt:
    cargo fmt

# Everything a change must pass: frontend types, Rust lint and format
[group('check')]
check: typecheck lint
