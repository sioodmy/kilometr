#!/usr/bin/env bash
# Sterowanie telefonem w trakcie testu PR: tap / swipe / tekst + zrzut ekranu.
#
# Współrzędne podajemy w skonie zrzutów 922x2048 (tak, jak widać podgląd),
# a skrypt przelicza je na rzeczywiste 1080x2400 telefonu — inaczej trafia
# się kilkaset pikseli obok.
#
# Użycie:
#   scripts/dev-tap.sh 400 1860             # tap (współrzędne ze zrzutu)
#   scripts/dev-tap.sh --swipe 540 1600 540 600 [ms]
#   scripts/dev-tap.sh --text "Rynek"
#   scripts/dev-tap.sh --key BACK
#   scripts/dev-tap.sh --shot nazwa [sekundy]
set -euo pipefail

export PATH="$HOME/Android/Sdk/platform-tools:$PATH"
OUT_DIR="${SHOT_DIR:-/tmp/opencode/shots}"
SHOT_W=922
SHOT_H=2048
DEV_W=1080
DEV_H=2400
mkdir -p "$OUT_DIR"

sx() { awk -v v="$1" -v a="$SHOT_W" -v b="$DEV_W" 'BEGIN{printf "%d", v*b/a}'; }
sy() { awk -v v="$1" -v a="$SHOT_H" -v b="$DEV_H" 'BEGIN{printf "%d", v*b/a}'; }

# Nazwa pliku na urządzeniu: tylko bezpieczne znaki, żeby spacja lub `;`
# nie rozbiły ścieżki ani nie wstrzyknęły komendy w shellu telefonu.
safe_name() { printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_'; }

# Tekst dla `input text`: escapujemy cudzysłowy i spacje pod shell telefonu,
# a całość pakujemy w pojedyncze cudzysłowy — `;`, `$`, `(` itd. są wtedy literałami.
shell_text() { printf '%s' "$1" | sed "s/'/'\\\\''/g; s/ /%s/g"; }

shot() {
  local name wait
  name="$(safe_name "$1")"
  wait="${2:-0}"
  [ "$wait" != "0" ] && sleep "$wait"
  adb shell screencap -p "/sdcard/$name.png" >/dev/null
  adb pull "/sdcard/$name.png" "$OUT_DIR/$name.png" >/dev/null
  echo "$OUT_DIR/$name.png"
}

case "${1:-}" in
  --swipe) adb shell input swipe "$(sx "$2")" "$(sy "$3")" "$(sx "$4")" "$(sy "$5")" "${6:-300}" ;;
  --text)  adb shell input text "'$(shell_text "$2")'" ;;
  --key)   adb shell input keyevent "$2" ;;
  --shot)  shot "$2" "${3:-0}" ;;
  *)       adb shell input tap "$(sx "$1")" "$(sy "$2")" ;;
esac
