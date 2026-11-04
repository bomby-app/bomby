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

# Run the app with hot reload: Vite serves the frontend, cargo builds and opens the window
[group('run')]
[working-directory: 'app']
dev:
    bun run tauri dev

# Build the release app bundle (.app and .dmg on macOS) into app/src-tauri/target/release/bundle,
# with the voice agent frozen first (`just agent freeze`), which the bundle ships
[group('run')]
[working-directory: 'app']
build:
    {{ just_executable() }} --justfile {{ justfile_directory() }}/justfile agent freeze
    bun run tauri build

# Format-check, lint and type-check the frontend (Vite+: Oxfmt, Oxlint, tsgolint) and the Rust core (clippy, rustfmt); warnings fail
[group('check')]
[working-directory: 'app']
lint:
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

# Run the Rust core's unit tests
[group('check')]
[working-directory: 'app']
test:
    cargo test --manifest-path src-tauri/Cargo.toml

# Everything a change must pass: format, lint and types for both halves, tests
[group('check')]
check: lint test
