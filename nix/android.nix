{
  pkgs,
  system,
}: let
  # Wersje przypięte do tych, na których zweryfikowano działający build.
  sdk =
    (pkgs.androidenv.composeAndroidPackages {
      cmdLineToolsVersion = "latest";
      platformToolsVersion = "latest";
      # 36: aktualny toolchain; 35: wymagany przez template Expo SDK 57
      # (compileSdk 35 + build-tools 35.0.0) — bez tego Gradle próbuje
      # dociągać komponenty do read-only nix store i build pada.
      platformVersions = ["35" "36"];
      buildToolsVersions = ["35.0.0" "36.0.0"];
      includeEmulator = false;
      includeCmake = true;
      cmakeVersions = ["3.22.1"];
      includeNDK = true;
      ndkVersions = ["27.1.12297006"];
    }).androidsdk;

  # Sysroot x86_64 dla qemu-user (host ARM nie ma /lib64):
  # PRAWDZIWE pliki (nie symlinki — qemu podwójnie prefixuje absolutne
  # symlinki i loader ich wtedy nie widzi).
  sysroot = let
    cross = pkgs.pkgsCross.gnu64;
  in
    pkgs.runCommand "x86-sysroot" {} ''
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
  sdkInjected = pkgs.runCommand "android-sdk-injected" {} ''
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

  needsQemu = system == "aarch64-linux";
  effectiveSysroot =
    if needsQemu
    then sysroot
    else null;
in {
  inherit sdk sdkInjected;

  env = {
    # sdkInjected to shadow-tree, którego rootem jest już katalog android-sdk
    ANDROID_HOME = "${sdkInjected}";
    ANDROID_SDK_ROOT = "${sdkInjected}";
    JAVA_HOME = "${pkgs.jdk17}";
    QEMU_LD_PREFIX =
      if effectiveSysroot == null
      then ""
      else "${effectiveSysroot}";
  };
}
