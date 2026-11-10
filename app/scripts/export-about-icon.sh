#!/usr/bin/env bash
# Render src-tauri/icons/Bomby.icon as macOS draws it in the Dock (gloss, depth, shadow) for
# Settings, About: the light and dark renditions at 64 pt, 2x for Retina, into
# src/features/about/. Icon Composer's ictool does the rendering, so the picture matches the
# Dock's. See docs/tauri-notes.md#icons.
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
ICTOOL="$(xcode-select -p)/../Applications/Icon Composer.app/Contents/Executables/ictool"

[[ -x "$ICTOOL" ]] || { echo "ictool needs Xcode's Icon Composer" >&2; exit 1; }

for rendition in Default Dark; do
  name=$([[ $rendition == Default ]] && echo light || echo dark)
  "$ICTOOL" "$APP/src-tauri/icons/Bomby.icon" --export-image \
    --output-file "$APP/src/features/about/app-icon-$name@2x.png" \
    --platform macOS --rendition "$rendition" --width 64 --height 64 --scale 2 \
    </dev/null >/dev/null
done
echo "wrote src/features/about/app-icon-{light,dark}@2x.png"
