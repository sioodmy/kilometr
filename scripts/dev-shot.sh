#!/usr/bin/env bash
# Zrzut ekranu z podpiętego telefonu (dev build + Metro).
# Użycie: scripts/dev-shot.sh <nazwa> [sekundy-czekania]
set -euo pipefail

export PATH="$HOME/Android/Sdk/platform-tools:$PATH"
NAME="${1:-shot}"
WAIT="${2:-0}"
OUT_DIR="${SHOT_DIR:-/tmp/opencode/shots}"
mkdir -p "$OUT_DIR"

if [ "$WAIT" != "0" ]; then sleep "$WAIT"; fi
adb shell screencap -p "/sdcard/$NAME.png"
adb pull "/sdcard/$NAME.png" "$OUT_DIR/$NAME.png" >/dev/null
echo "$OUT_DIR/$NAME.png"
