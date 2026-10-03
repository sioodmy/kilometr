#!/usr/bin/env bash
# Skrypt do samodzielnej kompilacji APK na maszynie wirtualnej w Azure (Ubuntu 22.04 / 24.04).
# Zużywa kredyty z Twojego konta Azure (VM np. Standard_D4s_v5 lub B4ms).
set -euo pipefail

echo "=========================================="
echo "🚀 1. Instalacja narzędzi systemowych (Java 17, build-essential)"
echo "=========================================="
sudo apt-get update -y
sudo apt-get install -y openjdk-17-jdk git curl unzip build-essential

echo "=========================================="
echo "📦 2. Sprawdzanie / instalacja Node.js 20"
echo "=========================================="
if ! command -v node >/dev/null || [[ "$(node -v | cut -d'.' -f1)" != "v20" && "$(node -v | cut -d'.' -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Node version: $(node -v)"
echo "NPM version:  $(npm -v)"
echo "Java version: $(java -version 2>&1 | head -n 1)"

echo "=========================================="
echo "🤖 3. Przygotowanie Android SDK"
echo "=========================================="
export ANDROID_HOME="$HOME/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

if [ ! -d "$ANDROID_HOME/cmdline-tools/latest" ]; then
  echo "Pobieranie Command Line Tools..."
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  TEMP_ZIP="/tmp/cmdline-tools.zip"
  curl -fsSL -o "$TEMP_ZIP" https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q "$TEMP_ZIP" -d "$ANDROID_HOME/cmdline-tools"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -f "$TEMP_ZIP"
fi

echo "Akceptacja licencji..."
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true

echo "Instalacja platform 35, 36 oraz build-tools 35.0.0..."
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platforms;android-35" "platforms;android-36" "build-tools;35.0.0" "platform-tools"

echo "=========================================="
echo "📦 4. Instalacja zależności projektu (npm ci)"
echo "=========================================="
npm ci

echo "=========================================="
echo "⚙️  5. Expo Prebuild (generowanie katalogu android/)"
echo "=========================================="
npx expo prebuild --platform android --clean --no-install

echo "=========================================="
echo "🔨 6. Kompilacja APK (assembleRelease)"
echo "=========================================="
cd android
chmod +x gradlew
./gradlew assembleRelease -x lint --no-daemon --console=plain

APK_OUTPUT="app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK_OUTPUT" ]; then
  echo ""
  echo "=========================================="
  echo "🎉 SUKCES! Plik APK został pomyślnie skompilowany:"
  echo "Ścieżka: $(pwd)/$APK_OUTPUT"
  echo "Rozmiar: $(du -h "$APK_OUTPUT" | cut -f1)"
  echo "=========================================="
  echo ""
  echo "💡 Aby pobrać plik na swój komputer, możesz na maszynie odpalić prosty serwer HTTP:"
  echo "   cd $(pwd)/app/build/outputs/apk/release && python3 -m http.server 8080"
  echo "   (a następnie wejść w przeglądarce pod: http://<IP_TWOJEJ_MASZYNY>:8080/app-release.apk)"
else
  echo "❌ Nie znaleziono pliku APK w oczekiwanej ścieżce." >&2
  exit 1
fi
