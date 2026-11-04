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

# Lint and format-check the frontend (Biome) and the Rust core (clippy, rustfmt); warnings fail
[group('check')]
[working-directory: 'app']
lint:
    bun x biome check .
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
    cargo fmt --manifest-path src-tauri/Cargo.toml --check

# Format the frontend and the Rust core, and apply Biome's safe fixes (import order)
[group('check')]
[working-directory: 'app']
fmt:
    bun x biome check --write .
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

# Run the Rust core's unit tests
[group('check')]
[working-directory: 'app']
test:
    cargo test --manifest-path src-tauri/Cargo.toml

# Everything a change must pass: frontend types, lint and format for both halves, tests
[group('check')]
check: typecheck lint test
