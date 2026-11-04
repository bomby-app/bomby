#!/usr/bin/env bash
# Compile src-tauri/icons/Bomby.icon (Icon Composer: light, dark, clear and tinted) into
# src-tauri/icons/Assets.car, which the bundle ships via bundle.macOS.files with
# CFBundleIconName=Bomby (src-tauri/Info.plist). macOS 26+ reads Assets.car; older macOS
# uses icon.icns.
#
# Why not let `tauri build` do it: with Xcode 27, actool hands the work to a persistent
# ibtoold daemon, and when tauri-bundler runs actool that daemon fails ("Bad file
# descriptor", "Failed to create a catalog from the Icon Studio document";
# tauri-apps/tauri#16386). From a plain shell, with the daemon restarted and stdin from
# /dev/null, it works. See docs/tauri-notes.md#icons.
set -euo pipefail

ICONS="$(cd "$(dirname "$0")/../src-tauri/icons" && pwd)"
NAME=Bomby

[[ "$(uname -s)" == Darwin ]] || { echo "Assets.car needs macOS and Xcode" >&2; exit 1; }

for attempt in 1 2 3; do
  pkill -x ibtoold 2>/dev/null || true
  sleep 2
  work="$(mktemp -d)"
  cp -R "$ICONS/$NAME.icon" "$work/"
  mkdir "$work/out"
  xcrun actool "$work/$NAME.icon" --compile "$work/out" \
    --output-partial-info-plist "$work/out/partial.plist" \
    --app-icon "$NAME" --include-all-app-icons \
    --enable-on-demand-resources NO --development-region en \
    --target-device mac --platform macosx --minimum-deployment-target 12.0 \
    </dev/null >"$work/log" 2>&1 || true
  if [[ -s "$work/out/Assets.car" ]]; then
    cp "$work/out/Assets.car" "$ICONS/Assets.car"
    rm -rf "$work"
    echo "wrote src-tauri/icons/Assets.car (attempt $attempt)"
    exit 0
  fi
  echo "actool attempt $attempt failed:" >&2
  grep -i "error" "$work/log" >&2 || cat "$work/log" >&2
  rm -rf "$work"
done
echo "actool could not compile $NAME.icon" >&2
exit 1
