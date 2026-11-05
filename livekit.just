# The LiveKit server Bomby runs on this Mac (docs/decisions/livekit-on-this-mac-or-cloud.md),
# built from LiveKit's source for the app to bundle as a sidecar (bundle.externalBin).
#
# Typical use:
#     just livekit build        build it, unless this version is built already
#     just livekit version      the version the app bundles
#
# No macOS build is published (its .goreleaser.yaml builds Linux and Windows only), so it's
# built from the release's source, checked against its pinned hash, as Homebrew does. Its
# go.mod has `replace` lines, so `go install ...@version` can't build it.

version := "1.13.10"
sha256 := "d1b93ced314b14654faceeb99627a79114b8ebe002bb5d620be4a185db83a4b2"
# Where tauri.conf.json takes the program and its license from.
binaries := justfile_directory() / "app/src-tauri/binaries"
# Where Go fetches and builds: the app's cargo target/, never the home folder.
work := justfile_directory() / "app/src-tauri/target/livekit-server"

# List the LiveKit recipes
default:
    @just --unsorted --list livekit

# Build the server into app/src-tauri/binaries for the app to bundle (skipped when this version is there)
[group('build')]
build:
    #!/usr/bin/env bash
    set -euo pipefail
    # Tauri names a sidecar by the target it's built for.
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
    # Stripped, with no local paths in it. cgo stays on, as in Homebrew's build: on macOS the
    # CPU stats LiveKit reads (protocol/utils/hwstats) come through cgo. It links only system
    # libraries (docs/livekit-notes.md#the-bundled-server).
    cd "{{ work }}/src"
    GOPATH="{{ work }}/go" GOFLAGS=-modcacherw CGO_ENABLED=1 GOOS=darwin GOARCH=$arch \
      go build -trimpath -ldflags "-s -w" -o "$out" ./cmd/server
    cp LICENSE "{{ binaries }}/livekit-server-LICENSE.txt"
    "$out" --version

# Print the version the app bundles
version:
    @echo {{ version }}
