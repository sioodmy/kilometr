#!/usr/bin/env bash
set -e

echo "📱 Sprawdzanie połączenia ADB z telefonem..."

# Jeśli serwer ADB nie widzi urządzenia, zrestartuj go
DEVICE_COUNT=$(adb devices | grep -v "List" | grep -v "^$" | wc -l)
if [ "$DEVICE_COUNT" -eq 0 ]; then
  echo "⚠️ Brak urządzeń w buforze. Restartuję serwer ADB..."
  adb kill-server >/dev/null 2>&1 || true
  adb start-server >/dev/null 2>&1 || true
fi

DEVICES=$(adb devices | grep -v "List" | grep -v "^$" || true)

if [ -z "$DEVICES" ]; then
  echo "❌ Nie wykryto podłączonego telefonu przez USB!"
  echo "   Upewnij się, że:"
  echo "   1. Telefon jest podłączony kablem USB"
  echo "   2. Opcje programisty i Debugowanie USB są włączone"
  echo "   3. Na ekranie telefonu zaakceptowano autoryzację komputera"
  exit 1
fi

DEVICE_ID=$(echo "$DEVICES" | head -n 1 | awk '{print $1}')
DEVICE_STATE=$(echo "$DEVICES" | head -n 1 | awk '{print $2}')

if [ "$DEVICE_STATE" = "unauthorized" ]; then
  echo "⚠️ Telefon [$DEVICE_ID] wymaga autoryzacji debugowania USB."
  echo "   Odblokuj ekran telefonu i kliknij 'Zezwalaj zawsze z tego komputera'."
  exit 1
fi

echo "✅ Wykryto urządzenie: $DEVICE_ID"

# Weryfikacja serwisów na komputerze
if curl -s "http://localhost:8081/status" >/dev/null 2>&1; then
  echo "🟢 Metro Bundler działa (port 8081)"
else
  echo "🟡 Uwaga: Metro bundler (port 8081) nie odpowiada. Upewnij się, że 'npx expo start' działa."
fi

if curl -s "http://localhost:3000/api/health" >/dev/null 2>&1; then
  echo "🟢 Backend API działa (port 3000)"
else
  echo "🟡 Uwaga: Backend API (port 3000) nie odpowiada. Upewnij się, że 'npm run server:dev' działa."
fi

# Ustawienie tuneli portów
echo "🔌 Konfiguracja reverse portów (8081 Metro, 3000 Backend)..."
adb -s "$DEVICE_ID" reverse tcp:8081 tcp:8081
adb -s "$DEVICE_ID" reverse tcp:3000 tcp:3000

# Wybudzenie ekranu telefonu
echo "💡 Wybudzanie ekranu..."
adb -s "$DEVICE_ID" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb -s "$DEVICE_ID" shell wm dismiss-keyguard >/dev/null 2>&1 || true

# Otwarcie Expo Go z aplikacją kilometr
echo "🚀 Uruchamianie aplikacji w Expo Go..."
adb -s "$DEVICE_ID" shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" host.exp.exponent >/dev/null 2>&1

echo "🎉 Gotowe! Aplikacja została otwarta na telefonie."
