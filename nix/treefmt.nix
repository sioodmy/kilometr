{pkgs, ...}: {
  projectRootFile = "flake.nix";

  # 1. Nix formatting
  programs.alejandra.enable = true;

  # 2. TypeScript / JavaScript / JSON / Markdown / YAML / HTML / CSS
  programs.prettier.enable = true;

  # 3. Shell / Bash scripting
  programs.shfmt.enable = true;
  programs.shfmt.indent_size = 2;

  # 4. Kotlin (Android modules)
  programs.ktfmt.enable = true;

  # 5. Java (Android native code)
  programs.google-java-format.enable = true;

  # Exclude build artifacts, generated directories, caches, locks, and media
  settings.global.excludes = [
    "*.png"
    "*.jpg"
    "*.jpeg"
    "*.gif"
    "*.ico"
    "*.keystore"
    "*.jks"
    "*.patch"
    "flake.lock"
    "package-lock.json"
    "server/package-lock.json"
    "android/**"
    "node_modules/**"
    "server/node_modules/**"
    "server/data/**"
    "server/dist/**"
    ".expo/**"
    "dist/**"
    "modules/*/android/build/**"
    "modules/*/android/.gradle/**"
    "modules/*/android/.cxx/**"
  ];
}
