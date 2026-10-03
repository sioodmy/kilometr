{
  description = "kilometr — headless dev-build APK (Expo, Android, Nix)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    treefmt-nix,
  }: let
    systems = [
      "aarch64-linux"
      "x86_64-linux"
    ];
    forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f system);

    pkgsFor = system:
      import nixpkgs {
        inherit system;
        config = {
          allowUnfree = true;
          android_sdk.accept_license = true;
        };
      };

    treefmtEval = forEachSystem (
      system:
        treefmt-nix.lib.evalModule (pkgsFor system) ./nix/treefmt.nix
    );
  in {
    formatter = forEachSystem (system: treefmtEval.${system}.config.build.wrapper);

    checks = forEachSystem (system: {
      formatting = treefmtEval.${system}.config.build.check self;
    });

    devShells = forEachSystem (system: let
      pkgs = pkgsFor system;
      android = import ./nix/android.nix {inherit pkgs system;};
      env = android.env;
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
          if env.QEMU_LD_PREFIX == ""
          then ""
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

    apps = forEachSystem (
      system: let
        pkgs = pkgsFor system;
        android = import ./nix/android.nix {inherit pkgs system;};
      in
        import ./nix/apps.nix {
          inherit pkgs;
          env = android.env;
        }
    );
  };
}
