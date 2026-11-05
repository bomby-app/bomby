# Builds the LiveKit server the app bundles from source: LiveKit publishes no macOS binary.

version := "1.13.10"
sha256 := "d1b93ced314b14654faceeb99627a79114b8ebe002bb5d620be4a185db83a4b2"
binaries := justfile_directory() / "app/src-tauri/binaries"
work := justfile_directory() / "app/src-tauri/target/livekit-server"

# List the LiveKit recipes
default:
    @just --unsorted --list livekit

# Build the server into app/src-tauri/binaries for the app to bundle (skipped when this version is there)
[group('build')]
build:
    #!/usr/bin/env bash
    set -euo pipefail
    # Tauri names a sidecar by its target triple.
    triple=$(rustc --print host-tuple)
    case $triple in
      aarch64-*) arch=arm64 ;;
      x86_64-*) arch=amd64 ;;
      *) echo "No LiveKit server build for $triple"; exit 1 ;;
    esac
    out="{{ binaries }}/livekit-server-$triple"
    if [[ -x $out ]] && "$out" --version | grep -qx "livekit-server version {{ version }}"; then
      exit 0
    fi
    rm -rf "{{ work }}/src" && mkdir -p "{{ work }}/src" "{{ binaries }}"
    curl -fsSL "https://github.com/livekit/livekit/archive/refs/tags/v{{ version }}.tar.gz" -o "{{ work }}/src.tar.gz"
    echo "{{ sha256 }}  {{ work }}/src.tar.gz" | shasum -a 256 -c --quiet
    tar -xzf "{{ work }}/src.tar.gz" -C "{{ work }}/src" --strip-components 1
    # cgo stays on: LiveKit's CPU stats need it on macOS (protocol/utils/hwstats).
    cd "{{ work }}/src"
    GOPATH="{{ work }}/go" GOFLAGS=-modcacherw CGO_ENABLED=1 GOOS=darwin GOARCH=$arch \
      go build -trimpath -ldflags "-s -w" -o "$out" ./cmd/server
    cp LICENSE "{{ binaries }}/livekit-server-LICENSE.txt"
    "$out" --version

# Print the version the app bundles
version:
    @echo {{ version }}
