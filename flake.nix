{
  description = "kilometr — headless dev-build APK (Expo, Android, Nix)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-linux" "x86_64-linux" ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f system);

      pkgsFor = system: import nixpkgs {
        inherit system;
        config = {
          allowUnfree = true;
          android_sdk.accept_license = true;
        };
      };

      # Wersje przypięte do tych, na których zweryfikowano działający build.
      sdkFor = pkgs: (pkgs.androidenv.composeAndroidPackages {
        cmdLineToolsVersion = "latest";
        platformToolsVersion = "latest";
        # 36: aktualny toolchain; 35: wymagany przez template Expo SDK 57
        # (compileSdk 35 + build-tools 35.0.0) — bez tego Gradle próbuje
        # dociągać komponenty do read-only nix store i build pada.
        platformVersions = [ "35" "36" ];
        buildToolsVersions = [ "35.0.0" "36.0.0" ];
        includeEmulator = false;
        includeCmake = true;
        cmakeVersions = [ "3.22.1" ];
        includeNDK = true;
        ndkVersions = [ "27.1.12297006" ];
      }).androidsdk;

      # Sysroot x86_64 dla qemu-user (host ARM nie ma /lib64):
      # PRAWDZIWE pliki (nie symlinki — qemu podwójnie prefixuje absolutne
      # symlinki i loader ich wtedy nie widzi).
      sysrootFor = pkgs:
        let cross = pkgs.pkgsCross.gnu64; in
        pkgs.runCommand "x86-sysroot" { } ''
          mkdir -p $out/lib64
          cp -L ${cross.glibc}/lib/ld-linux-x86-64.so.2 $out/lib64/
          for lib in libc.so.6 libm.so.6 libpthread.so.0 libdl.so.2 librt.so.1; do
            cp -L ${cross.glibc}/lib/$lib $out/lib64/
          done
          cp -L ${cross.zlib}/lib/libz.so.1 $out/lib64/
          cp -L ${cross.gcc.cc.lib}/lib/libstdc++.so.6 $out/lib64/libstdc++.so.6.0
          mv $out/lib64/libstdc++.so.6.0 $out/lib64/libstdc++.so.6
          # qemu-user szuka bibliotek gościa w /lib i /usr/lib (z prefixem
          # QEMU_LD_PREFIX), a NIE w /lib64 — bez tych dowiązań clang z NDK
          # pada z "libz.so.1: cannot open shared object file".
          # Dowiązania względne (nie absolutne — te qemu podwójnie prefixuje).
          mkdir -p $out/lib $out/usr/lib
          for f in $out/lib64/*; do
            b=$(basename "$f")
            ln -s ../lib64/$b $out/lib/$b
            ln -s ../../lib64/$b $out/usr/lib/$b
          done
        '';

      # Shadow-tree: PRAWDZIWE katalogi + symlinkowane pliki, plus jeden
      # katalog z PRAWDZIWYMI brakującymi libami NDK clanga.
      # (cp -as kopiuje też bity read-only ze store — chmod MUSI być zaraz
      # po kopii, inaczej każde rm/mkdir pada z EACCES. qemu podwójnie
      # prefixuje absolutne symlinki, więc symlinkowane KATALOGI
      # materializujemy w pętli.)
      sdkInjectedFor = pkgs: sdk:
        pkgs.runCommand "android-sdk-injected" { } ''
          set -euo pipefail
          mkdir -p $out
          cp -as ${sdk}/libexec/android-sdk/. $out/
          chmod -R u+w $out
          for _ in $(seq 1 12); do
            changed=0
            while IFS= read -r -d ''' l; do
              if [ -d "$l" ]; then
                target=$(readlink "$l")
                case "$target" in
                  /*) ;;
                  *) target="$(dirname "$l")/$target" ;;
                esac
                rm "$l" && mkdir -p "$l" && cp -as "$target/." "$l/"
                changed=1
              fi
            done < <(find "$out" -type l -print0)
            [ "$changed" -eq 0 ] && break
          done
          chmod -R u+w $out
          for toolLib in $out/ndk/*/toolchains/llvm/prebuilt/linux-x86_64/lib/x86_64-unknown-linux-gnu; do
            [ -d "$toolLib" ] || continue
            rm -rf "$toolLib"
            mkdir -p "$toolLib"
            srcLib=${sdk}/libexec/android-sdk/''${toolLib#$out/}
            for f in "$srcLib"/*; do
              ln -s "$f" "$toolLib/$(basename "$f")"
            done
          done
          for toolLib in $out/ndk/*/toolchains/llvm/prebuilt/linux-x86_64/lib/x86_64-unknown-linux-gnu; do
            cp -L --remove-destination \
              ${pkgs.pkgsCross.gnu64.zlib}/lib/libz.so.1 \
              "$toolLib/libz.so.1"
            cp -L --remove-destination \
              ${pkgs.pkgsCross.gnu64.gcc.cc.lib}/lib/libstdc++.so.6 \
              "$toolLib/libstdc++.so.6"
          done
        '';

      # qemu-user + sysroot x86_64 są potrzebne TYLKO na hostach ARM —
      # NDK ma binaria x86_64. Na hoście x86_64 dorzucenie sysrootu do
      # LD_LIBRARY_PATH podmienia libc JVM i Gradle pada z segfaultem
      # jeszcze przed kompilacją, więc tam zostawiamy LD_LIBRARY_PATH
      # nietknięte.
      envFor = system: pkgs:
        let
          sdk = sdkFor pkgs;
          sdkW = sdkInjectedFor pkgs sdk;
          needsQemu = system == "aarch64-linux";
          sysroot = if needsQemu then sysrootFor pkgs else null;
        in {
          # sdkW to shadow-tree, którego rootem jest już katalog android-sdk
          ANDROID_HOME = "${sdkW}";
          ANDROID_SDK_ROOT = "${sdkW}";
          JAVA_HOME = "${pkgs.jdk17}";
          QEMU_LD_PREFIX = if sysroot == null then "" else "${sysroot}";
        };
    in
    {
      devShells = forEachSystem (system:
        let
          pkgs = pkgsFor system;
          env = envFor system pkgs;
        in {
          default = pkgs.mkShell {
          packages = with pkgs; [
            jdk17
            nodejs_22
            qemu-user
            git
            curl
          ];
            inherit (env) ANDROID_HOME ANDROID_SDK_ROOT JAVA_HOME QEMU_LD_PREFIX;
            LD_LIBRARY_PATH =
              if env.QEMU_LD_PREFIX == "" then ""
              else "${env.QEMU_LD_PREFIX}/lib64";
            shellHook = ''
              echo "kilometr dev-shell: ANDROID_HOME=$ANDROID_HOME"
              if [ -n "$QEMU_LD_PREFIX" ]; then
                echo "  sysroot: $QEMU_LD_PREFIX | $(QEMU_LD_PREFIX=$QEMU_LD_PREFIX ${env.ANDROID_HOME}/cmake/3.22.1/bin/cmake --version 2>/dev/null | head -1 || echo 'cmake check skipped')"
              else
                echo "  host x86_64: bez qemu sysrootu (LD_LIBRARY_PATH nietknięty)"
              fi
            '';
          };
        });

      apps = forEachSystem (system:
        let
          pkgs = pkgsFor system;
          env = envFor system pkgs;
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
              if [ -n "$QEMU_LD_PREFIX" ]; then
                export LD_LIBRARY_PATH="$QEMU_LD_PREFIX/lib64''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
              fi

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

              # AGP wypakowuje własne aapt2 z Maven — na NixOS stub-ld
              # odmawia uruchomienia generycznego binarium ("NixOS cannot run
              # dynamically linked executables"), więc każde zadanie
              # mergujące zasoby pada. Wskazujemy aapt2 z SDK, które jest
              # już łatane pod nix.
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
            program = buildScript { defaultRelease = false; };
          };
          build-release-apk = {
            type = "app";
            program = buildScript { defaultRelease = true; };
          };
        });
    };
}
