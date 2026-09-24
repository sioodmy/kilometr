#!/usr/bin/env bash
# Uruchamia apkę Kilometr na telefonie przez USB (ADB + Expo Go).
# Sam stawia Metro i backend, jeśli nie działają — wystarczy `npm run phone`.
#
# Wymagania: podłączony telefon (debugowanie USB), zainstalowane Expo Go.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
METRO_STATUS="http://localhost:8081/status"
API_HEALTH="http://localhost:3000/api/health"
METRO_LOG="$ROOT/.expo/phone-metro.log"
SERVER_LOG="$ROOT/.expo/phone-server.log"
DEV_URL="exp://127.0.0.1:8081"
EXPO_GO_PKG="host.exp.exponent"

fail() { echo "❌ $1" >&2; exit 1; }

command -v adb >/dev/null || fail "Brak 'adb' w PATH. Zainstaluj Android Platform Tools."
command -v node >/dev/null || fail "Brak 'node' w PATH."
command -v npx >/dev/null || fail "Brak 'npx' w PATH."

echo "📱 Sprawdzanie połączenia ADB z telefonem..."

# Jeśli serwer ADB nie widzi nic, zrestartuj go (raz).
if [ -z "$(adb devices | awk 'NR>1 && NF>1')" ]; then
  echo "⚠️ Pusta lista urządzeń. Restartuję serwer ADB..."
  adb kill-server >/dev/null 2>&1 || true
  adb start-server >/dev/null 2>&1 || true
fi

DEVICE_ID="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [ -z "$DEVICE_ID" ]; then
  if adb devices | awk 'NR>1 && $2=="unauthorized"' | grep -q .; then
    fail "Telefon wymaga autoryzacji debugowania USB. Odblokuj ekran i kliknij 'Zezwalaj zawsze z tego komputera'."
  fi
  fail "Nie wykryto podłączonego telefonu przez USB! Sprawdź: kabel, opcje programisty + debugowanie USB, autoryzację komputera na telefonie."
fi

echo "✅ Wykryto urządzenie: $DEVICE_ID"

# Czeka aż URL zacznie zwracać 2xx (timeout w sekundach).
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

# Metro Bundler: bez niego Expo Go otwiera martwy URL i wisi na niebieskim ekranie.
if curl -sf -o /dev/null "$METRO_STATUS" 2>/dev/null; then
  echo "🟢 Metro Bundler działa (port 8081)"
else
  echo "🟡 Metro nie działa — uruchamiam 'npx expo start --localhost' w tle..."
  echo "   Log: $METRO_LOG"
  mkdir -p "$ROOT/.expo"
  (cd "$ROOT" && nohup npx expo start --localhost >"$METRO_LOG" 2>&1 &)
  wait_for "$METRO_STATUS" 120 "Metro Bundler" \
    || fail "Metro nie wstało w 120 s. Sprawdź log: $METRO_LOG"
fi

# Backend API: bez niego wyszukiwanie połączeń nie zadziała.
if curl -sf -o /dev/null "$API_HEALTH" 2>/dev/null; then
  echo "🟢 Backend API działa (port 3000)"
else
  echo "🟡 Backend nie działa — uruchamiam 'npm run server:dev' w tle..."
  echo "   (pierwszy start może pobierać rozkład GTFS ~12 MB; log: $SERVER_LOG)"
  mkdir -p "$ROOT/.expo"
  (cd "$ROOT" && TMPDIR=/tmp nohup npm run server:dev >"$SERVER_LOG" 2>&1 &)
  wait_for "$API_HEALTH" 180 "Backend API" \
    || fail "Backend nie wstał w 180 s. Sprawdź log: $SERVER_LOG"
fi

# Tunele USB: na telefonie 127.0.0.1:8081/3000 prowadzi do tego komputera.
echo "🔌 Konfiguracja reverse portów (8081 Metro, 3000 Backend)..."
adb -s "$DEVICE_ID" reverse tcp:8081 tcp:8081
adb -s "$DEVICE_ID" reverse tcp:3000 tcp:3000
adb -s "$DEVICE_ID" reverse --list

# Expo Go musi być zainstalowane, inaczej intent ginie po cichu.
if ! adb -s "$DEVICE_ID" shell pm list packages 2>/dev/null | grep -q "$EXPO_GO_PKG"; then
  fail "Na telefonie nie ma Expo Go ($EXPO_GO_PKG). Zainstaluj je ze Sklepu Play i spróbuj ponownie."
fi

# Wybudzenie ekranu telefonu.
echo "💡 Wybudzanie ekranu..."
adb -s "$DEVICE_ID" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb -s "$DEVICE_ID" shell wm dismiss-keyguard >/dev/null 2>&1 || true

# Otwarcie Expo Go z aplikacją kilometr (błędy celowo widoczne, nie tłumione).
echo "🚀 Uruchamianie aplikacji w Expo Go ($DEV_URL)..."
if adb -s "$DEVICE_ID" shell am start -a android.intent.action.VIEW -d "$DEV_URL" "$EXPO_GO_PKG"; then
  echo "🎉 Gotowe! Aplikacja powinna otworzyć się na telefonie."
  echo "   Jeśli telefon wisi na ekranie ładowania >30 s, sprawdź log Metro: $METRO_LOG"
else
  fail "Komenda 'am start' nie powiodła się (szczegóły wyżej)."
fi
