#!/usr/bin/env bash
# preview-transfer.sh - Szybkie uruchamianie i podgląd ochrony przesiadek na telefonie
# Użycie:
#   npm run preview:transfer
#   ./scripts/preview-transfer.sh [rail|tram] [conductor|waiting|safe|risk|alternative|noAlternative|unavailable] [--shot [nazwa]]
#
# Przykłady dla agentów i developerów:
#   ./scripts/preview-transfer.sh                          # Trasa kolejowa, tryb konduktora
#   ./scripts/preview-transfer.sh rail conductor --shot    # Zrób screenshot po otwarciu
#   ./scripts/preview-transfer.sh tram alternative --shot  # Trasa tramwajowa z alternatywą
#   ./scripts/preview-transfer.sh rail safe                # Trasa kolejowa ze statusem bezpiecznym
#   ./scripts/preview-transfer.sh --help                   # Wyświetl pomoc

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/Android/Sdk/platform-tools:$PATH"

METRO_STATUS="http://localhost:8081/status"
METRO_LOG="$ROOT/.expo/phone-metro.log"
EXPO_GO_PKG="host.exp.exponent"

# Domyślne wartości
MODE="rail"         # rail | tram
STATE=""            # jeśli puste: dla rail='conductor', dla tram='alternative'
EXPIRED="0"
DIRECT="0"
TAKE_SHOT=0
SHOT_NAME=""
CLOSE_SHEET=0

fail() { echo "❌ $1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Użycie: ./scripts/preview-transfer.sh [opcje] [tryb] [status]

Argumenty pozycyjne:
  tryb:     rail (kolej KD->IC, domyślnie) | tram / urban (tramwaj 4->10)
  status:   conductor | waiting | safe | risk | alternative | noAlternative | unavailable

Opcje:
  --rail            Trasa kolejowa (Legnica -> Warszawa Centralna, KD + IC)
  --tram, --urban   Trasa miejska (tramwaje 4 -> 10)
  --state <status>  Status ochrony przesiadki (np. conductor, alternative, risk)
  --expired         Oznacz propozycję alternatywną jako przedawnioną (expired=1)
  --direct          Połączenie bezpośrednie bez przesiadki (direct=1)
  --close-sheet     Zwiń arkusz po otwarciu (aby pokazać kartę i dolny pasek podróży)
  --shot [nazwa]    Zrób screenshot po załadowaniu ekranu i wypisz ścieżkę do pliku
  --help, -h        Wyświetl ten komunikat pomocy

Przykłady:
  ./scripts/preview-transfer.sh
  ./scripts/preview-transfer.sh rail conductor --shot
  ./scripts/preview-transfer.sh tram alternative --shot
  ./scripts/preview-transfer.sh rail risk --close-sheet --shot
EOF
  exit 0
}

# Parsowanie argumentów
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      ;;
    --rail)
      MODE="rail"
      shift
      ;;
    --tram|--urban)
      MODE="tram"
      shift
      ;;
    --state)
      STATE="${2:-}"
      shift 2
      ;;
    --expired)
      EXPIRED="1"
      shift
      ;;
    --direct)
      DIRECT="1"
      shift
      ;;
    --close-sheet)
      CLOSE_SHEET=1
      shift
      ;;
    --shot)
      TAKE_SHOT=1
      if [ $# -gt 1 ] && [[ "$2" != --* ]]; then
        SHOT_NAME="$2"
        shift 2
      else
        shift
      fi
      ;;
    rail|kolej)
      MODE="rail"
      shift
      ;;
    tram|tramwaj|urban|miejska)
      MODE="tram"
      shift
      ;;
    conductor|waiting|safe|risk|alternative|noAlternative|unavailable)
      STATE="$1"
      shift
      ;;
    *)
      echo "⚠️ Nieznany argument: $1" >&2
      usage
      ;;
  esac
done

if [ -z "$STATE" ]; then
  if [ "$MODE" = "rail" ]; then
    STATE="conductor"
  else
    STATE="alternative"
  fi
fi

command -v adb >/dev/null || fail "Brak 'adb' w PATH. Zainstaluj Android Platform Tools."

# 1. Sprawdzenie połączenia ADB
DEVICE_ID="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [ -z "$DEVICE_ID" ]; then
  adb kill-server >/dev/null 2>&1 || true
  adb start-server >/dev/null 2>&1 || true
  DEVICE_ID="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
fi

[ -z "$DEVICE_ID" ] && fail "Nie wykryto podłączonego telefonu przez USB (adb devices jest puste)."
echo "📱 Urządzenie ADB: $DEVICE_ID"

# 2. Sprawdzenie / uruchomienie Metro Bundlera
wait_for() {
  local url="$1" timeout="$2" label="$3" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then
      echo "🟢 $label działa"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

if curl -sf -o /dev/null "$METRO_STATUS" 2>/dev/null; then
  echo "🟢 Metro Bundler działa (port 8081)"
else
  echo "🟡 Uruchamianie Metro w tle ('npx expo start --localhost')..."
  mkdir -p "$ROOT/.expo"
  (cd "$ROOT" && nohup env NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first" npx expo start --localhost >"$METRO_LOG" 2>&1 &)
  wait_for "$METRO_STATUS" 60 "Metro Bundler" || fail "Metro nie wstało w 60 s. Sprawdź log: $METRO_LOG"
fi

# 3. Konfiguracja tuneli USB (reverse ports)
adb -s "$DEVICE_ID" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
adb -s "$DEVICE_ID" reverse tcp:3000 tcp:3000 >/dev/null 2>&1 || true

# 4. Wybudzenie telefonu i odblokowanie ekranu
adb -s "$DEVICE_ID" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb -s "$DEVICE_ID" shell wm dismiss-keyguard >/dev/null 2>&1 || true

# 5. Przygotowanie URL do dev screena
RAIL_PARAM="$([ "$MODE" = "rail" ] && echo "1" || echo "0")"
TARGET_PATH="/dev/transfer?rail=${RAIL_PARAM}&state=${STATE}"
[ "$EXPIRED" = "1" ] && TARGET_PATH="${TARGET_PATH}&expired=1"
[ "$DIRECT" = "1" ] && TARGET_PATH="${TARGET_PATH}&direct=1"

TARGET_URL="exp://127.0.0.1:8081/--${TARGET_PATH}"

echo "🚀 Uruchamianie: $TARGET_URL"
echo "   Tryb: $MODE | Status: $STATE"

# Uruchomienie intentu na telefonie (z bezpiecznym cytowaniem URL zawierającego znaki &)
adb -s "$DEVICE_ID" shell "am start -a android.intent.action.VIEW -d '$TARGET_URL' -p '$EXPO_GO_PKG' >/dev/null"

if [ "$CLOSE_SHEET" -eq 1 ]; then
  sleep 1.5
  # Kliknięcie przycisku wstecz, aby zamknąć bottom sheet i odsłonić kartę / pasek podróży
  adb -s "$DEVICE_ID" shell input keyevent 4
fi

# 6. Screenshot (jeśli zażądano)
if [ "$TAKE_SHOT" -eq 1 ]; then
  [ -z "$SHOT_NAME" ] && SHOT_NAME="transfer_${MODE}_${STATE}"
  SHOT_OUT="/tmp/${SHOT_NAME}.png"
  sleep 2
  adb -s "$DEVICE_ID" exec-out screencap -p > "$SHOT_OUT"
  echo "📸 Zrzut ekranu zapisany: $SHOT_OUT"

  # Jeśli istnieje katalog artefaktów agenta, skopiuj zrzut
  ARTIFACT_DIR="$(find /home/sioodmy/.t3/userdata/providers/antigravity -name 'railway_transfer_protection.md' 2>/dev/null | head -n 1 | xargs dirname 2>/dev/null || true)"
  if [ -n "$ARTIFACT_DIR" ] && [ -d "$ARTIFACT_DIR" ]; then
    cp "$SHOT_OUT" "$ARTIFACT_DIR/${SHOT_NAME}.png" 2>/dev/null || true
  fi
fi

echo "✅ Gotowe!"
