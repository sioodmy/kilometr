{
  description = "kilometr — transport publiczny Wrocławia bez czekania";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    android-nixpkgs = {
      url = "github:tadfisher/android-nixpkgs/stable";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, android-nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = nixpkgs.lib.genAttrs supportedSystems;

      pkgsFor = system: import nixpkgs {
        inherit system;
        config = {
          allowUnfree = true;
          android_sdk.accept_license = true;
        };
      };

      # Expo 53 wymaga Android SDK 35 (compileSdk=35, targetSdk=35).
      # NDK r27c (27.2.12479018) jest standardem dla RN 0.76+ i Expo 53.
      # Dodatkowo dołączamy platform-36 i build-tools-36.0.0 pod nowsze projekty.
      androidSdkFor = pkgs:
        android-nixpkgs.sdk.${pkgs.system} (sdkPkgs: with sdkPkgs; [
          build-tools-35-0-0
          build-tools-36-0-0
          cmdline-tools-latest
          platform-tools
          platforms-android-35
          platforms-android-36
          ndk-27-2-12479018
          cmake-3-22-1
        ]);

      # NDK dostarcza x86_64 ELF-y dla clang/llvm. Na maszynie aarch64 (np. Ampere)
      # gradle odpala te binarki i bez emulatora dostaje ENOEXEC / Exec format error.
      # Budujemy czyste środowisko bsd-user/qemu-x86_64 z glibc-em gościa:
      # loader qemu dostaje prefix do bibliotek x86_64, a binfmt_misc w kernelu
      # (lub wrapper w PATH) kieruje wywołania do emulatora.
      qemuGuestEnvFor = pkgs:
        if pkgs.stdenv.hostPlatform.isAarch64 then
          let
            x86Pkgs = pkgsFor "x86_64-linux";
          in pkgs.buildEnv {
            name = "qemu-x86_64-guest-env";
            paths = [
              x86Pkgs.glibc
              x86Pkgs.stdenv.cc.cc.lib
              x86Pkgs.zlib
              x86Pkgs.ncurses5
            ];
          }
        else null;

      envFor = pkgs:
        let
          androidSdk = androidSdkFor pkgs;
          qemuGuest = qemuGuestEnvFor pkgs;
        in {
          inherit androidSdk;
          ANDROID_HOME = "${androidSdk}/share/android-sdk";
          ANDROID_SDK_ROOT = "${androidSdk}/share/android-sdk";
          JAVA_HOME = "${pkgs.jdk17}";
          GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${androidSdk}/share/android-sdk/build-tools/35.0.0/aapt2";
          QEMU_LD_PREFIX = if qemuGuest != null then "${qemuGuest}" else "";
        };
    in {
      devShells = forEachSystem (system:
        let
          pkgs = pkgsFor system;
          env = envFor pkgs;
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [
              # Runtime JS / tooling
              nodejs_22
              nodePackages.npm

              # Android build toolchain
              env.androidSdk
              jdk17
              gradle

              # Natywne narzędzia i zależności Expo
              git
              curl
              unzip
              which
              file

              # Emulacja x86_64 dla NDK na maszynach ARM64 (np. Ampere / Apple Silicon VM)
            ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isAarch64 [
              pkgs.qemu-user
            ];

            inherit (env) ANDROID_HOME ANDROID_SDK_ROOT JAVA_HOME GRADLE_OPTS;

            shellHook = ''
              export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
              ${pkgs.lib.optionalString (env.QEMU_LD_PREFIX != "") ''
                export QEMU_LD_PREFIX="${env.QEMU_LD_PREFIX}"
                export LD_LIBRARY_PATH="${env.QEMU_LD_PREFIX}/lib64''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
              ''}

              # Utwórz lokalny android/local.properties jeśli nie istnieje
              if [ -d android ] && [ ! -f android/local.properties ]; then
                echo "sdk.dir=$ANDROID_HOME" > android/local.properties
                echo "ndk.dir=$ANDROID_HOME/ndk/27.2.12479018" >> android/local.properties
              fi

              echo "Kilometr dev shell gotowy."
              echo "  Node:    $(node -v)"
              echo "  Java:    $(java -version 2>&1 | head -n 1)"
              echo "  Android: $ANDROID_HOME"
            '';
          };
        });

      apps = forEachSystem (system:
        let
          pkgs = pkgsFor system;
          env = envFor pkgs;
          buildScript = { defaultRelease ? false }: pkgs.lib.getExe (pkgs.writeShellApplication {
            name = if defaultRelease then "kilometr-build-release-apk" else "kilometr-build-apk";
            runtimeInputs = with pkgs; [ nodejs_22 jdk17 git curl bash ];
            text = ''
              set -euo pipefail
              export CI=true
              export ANDROID_HOME="${env.ANDROID_HOME}"
              export ANDROID_SDK_ROOT="${env.ANDROID_SDK_ROOT}"
              export JAVA_HOME="${env.JAVA_HOME}"
              export QEMU_LD_PREFIX="${env.QEMU_LD_PREFIX}"
              export PATH="$ANDROID_HOME/platform-tools:$PATH"
              export LD_LIBRARY_PATH="${env.QEMU_LD_PREFIX}/lib64''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

              BUILD_TYPE="${if defaultRelease then "release" else "debug"}"
              GRADLE_TASK="${if defaultRelease then "assembleRelease" else "assembleDebug"}"
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
              if [ ! -d android ]; then
                echo "== expo prebuild =="
                npx expo prebuild --platform android
              fi
              echo "== gradle $GRADLE_TASK =="
              ./android/gradlew -p android "$GRADLE_TASK" -x lint --console=plain
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
          # Headless build: nix run .#build-apk [--release] [--install]
          build-apk = {
            type = "app";
            program = buildScript { defaultRelease = false; };
          };
          # Headless release build: nix run .#build-release-apk [--install]
          build-release-apk = {
            type = "app";
            program = buildScript { defaultRelease = true; };
          };
        });
    };
}
