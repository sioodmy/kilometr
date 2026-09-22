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
        platformVersions = [ "36" ];
        buildToolsVersions = [ "36.0.0" ];
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

      envFor = pkgs:
        let
          sdk = sdkFor pkgs;
          sdkW = sdkInjectedFor pkgs sdk;
          sysroot = sysrootFor pkgs;
        in {
          # sdkW to shadow-tree, którego rootem jest już katalog android-sdk
          ANDROID_HOME = "${sdkW}";
          ANDROID_SDK_ROOT = "${sdkW}";
          JAVA_HOME = "${pkgs.jdk17}";
          QEMU_LD_PREFIX = "${sysroot}";
        };
    in
    {
      devShells = forEachSystem (system:
        let
          pkgs = pkgsFor system;
          env = envFor pkgs;
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
            shellHook = ''
              echo "kilometr dev-shell: ANDROID_HOME=$ANDROID_HOME"
              echo "  sysroot: $QEMU_LD_PREFIX | $(QEMU_LD_PREFIX=$QEMU_LD_PREFIX ${env.ANDROID_HOME}/cmake/3.22.1/bin/cmake --version 2>/dev/null | head -1 || echo 'cmake check skipped')"
            '';
          };
        });

      apps = forEachSystem (system:
        let
          pkgs = pkgsFor system;
          env = envFor pkgs;
        in {
          # Headless build: nix run .#build-apk [--install]
          # Uruchamiać z katalogu repo. Bez interakcji, plain console.
          build-apk = {
            type = "app";
            program = pkgs.lib.getExe (pkgs.writeShellApplication {
              name = "kilometr-build-apk";
              runtimeInputs = with pkgs; [ nodejs_22 jdk17 git curl bash ];
              text = ''
                set -euo pipefail
                export CI=true
                export ANDROID_HOME="${env.ANDROID_HOME}"
                export ANDROID_SDK_ROOT="${env.ANDROID_SDK_ROOT}"
                export JAVA_HOME="${env.JAVA_HOME}"
                export QEMU_LD_PREFIX="${env.QEMU_LD_PREFIX}"
                export PATH="$ANDROID_HOME/platform-tools:$PATH"

                if [ ! -f package.json ] || [ ! -d node_modules/.bin/expo ]; then
                  echo "== npm ci =="
                  npm ci --no-audit --no-fund
                fi
                if [ ! -d android ]; then
                  echo "== expo prebuild =="
                  npx expo prebuild --platform android
                fi
                echo "== gradle assembleDebug =="
                ./android/gradlew -p android assembleDebug -x lint --console=plain
                APK="android/app/build/outputs/apk/debug/app-debug.apk"
                echo "== OK: $APK ($(du -h "$APK" | cut -f1)) =="

                if [ "''${1:-}" = "--install" ]; then
                  if ! command -v adb >/dev/null; then
                    echo "Brak adb w PATH — podłącz telefon i spróbuj ponownie." >&2
                    exit 1
                  fi
                  adb install -r "$APK"
                  adb reverse tcp:8081 tcp:8081 || true
                  adb reverse tcp:3000 tcp:3000 || true
                  echo "Zainstalowano. Uruchom aplikację na telefonie (Metro: npx expo start)."
                fi
              '';
            });
          };
        });
    };
}
