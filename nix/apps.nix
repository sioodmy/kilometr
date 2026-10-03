{
  pkgs,
  env,
}: let
  buildScript = {defaultRelease ? false}:
    pkgs.lib.getExe (pkgs.writeShellApplication {
      name =
        if defaultRelease
        then "kilometr-build-release-apk"
        else "kilometr-build-apk";
      runtimeInputs = with pkgs; [nodejs_22 jdk17 git curl bash];
      text = ''
        set -euo pipefail
        export CI=true
        export ANDROID_HOME="${env.ANDROID_HOME}"
        export ANDROID_SDK_ROOT="${env.ANDROID_SDK_ROOT}"
        export JAVA_HOME="${env.JAVA_HOME}"
        export QEMU_LD_PREFIX="${env.QEMU_LD_PREFIX}"
        export PATH="$ANDROID_HOME/platform-tools:$PATH"
        if [ -n "$QEMU_LD_PREFIX" ]; then
          export LD_LIBRARY_PATH="$QEMU_LD_PREFIX/lib64''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
        fi

        BUILD_TYPE="${
          if defaultRelease
          then "release"
          else "debug"
        }"
        GRADLE_TASK="${
          if defaultRelease
          then "assembleRelease"
          else "assembleDebug"
        }"
        INSTALL_FLAG=false

        for arg in "$@"; do
          case "$arg" in
            --release)
              BUILD_TYPE="release"
              GRADLE_TASK="assembleRelease"
              ;;
            --debug)
              BUILD_TYPE="debug"
              GRADLE_TASK="assembleDebug"
              ;;
            --install)
              INSTALL_FLAG=true
              ;;
          esac
        done

        if [ ! -f package.json ] || [ ! -d node_modules/.bin/expo ]; then
          echo "== npm ci =="
          npm ci --no-audit --no-fund
        fi

        NEEDS_PREBUILD=0
        if [ ! -d android ]; then
          NEEDS_PREBUILD=1
        elif [ -d modules ] && [ modules -nt android ]; then
          echo "== modules/ nowsze od android/ — regenerujemy =="
          NEEDS_PREBUILD=1
        fi
        if [ "$NEEDS_PREBUILD" = "1" ]; then
          echo "== expo prebuild =="
          npx expo prebuild --platform android
        fi

        GRADLE_EXTRA=()
        AAPT2="$ANDROID_HOME/build-tools/35.0.0/aapt2"
        if [ -x "$AAPT2" ]; then
          echo "== aapt2: $AAPT2 =="
          GRADLE_EXTRA+=("-Pandroid.aapt2FromMavenOverride=$AAPT2")
        fi

        echo "== gradle $GRADLE_TASK =="
        ./android/gradlew -p android "$GRADLE_TASK" -x lint --console=plain "''${GRADLE_EXTRA[@]}"
        APK="android/app/build/outputs/apk/$BUILD_TYPE/app-$BUILD_TYPE.apk"
        echo "== OK: $APK ($(du -h "$APK" | cut -f1)) =="

        if [ "$INSTALL_FLAG" = "true" ]; then
          if ! command -v adb >/dev/null; then
            echo "Brak adb w PATH — podłącz telefon i spróbuj ponownie." >&2
            exit 1
          fi
          echo "== Instalowanie $APK na urządzeniu =="
          adb install -r "$APK"
          if [ "$BUILD_TYPE" = "debug" ]; then
            adb reverse tcp:8081 tcp:8081 || true
            adb reverse tcp:3000 tcp:3000 || true
            echo "Zainstalowano debug. Uruchom aplikację na telefonie (Metro: npx expo start)."
          else
            adb reverse --remove-all || true
            echo "Zainstalowano release (offline standalone)."
            adb shell monkey -p com.anonymous.kilometr -c android.intent.category.LAUNCHER 1 || true
          fi
        fi
      '';
    });
in {
  build-apk = {
    type = "app";
    program = buildScript {defaultRelease = false;};
  };
  build-release-apk = {
    type = "app";
    program = buildScript {defaultRelease = true;};
  };
}
