#!/usr/bin/env bash
set -euo pipefail

# Latwe lokalne uruchomienie backendu kilometr-api na komputerze deweloperskim.
# Uzycie:
#   ./backend/dev-local.sh                    (live polling dla Wroclawia, Warszawy i Krakowa)
#   ./backend/dev-local.sh --demo             (zasiewa historie i przykladowy zator do testow UI)
#   ./backend/dev-local.sh --cities=wroclaw   (wlasna lista miast)
#   ./backend/dev-local.sh --all-cities       (wszystkie 120 miast live)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PORT="${KILOMETR_PORT:-8080}"
CITIES="${KILOMETR_ONLY_CITIES:-wroclaw,warszawa,krakow}"
SEED_DEMO="false"
NO_COLLECTORS="false"

for arg in "$@"; do
  case "$arg" in
    --demo) SEED_DEMO="true" ;;
    --no-collectors) NO_COLLECTORS="true" ;;
    --all-cities) CITIES="" ;;
    --cities=*) CITIES="${arg#*=}" ;;
    --port=*) PORT="${arg#*=}" ;;
    *) echo "Nieznana opcja: $arg" >&2; exit 1 ;;
  esac
done

DATA_DIR="${SCRIPT_DIR}/local-data"
mkdir -p "$DATA_DIR"

# Wykryj adres LAN do testow na fizycznym telefonie po Wi-Fi.
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

# Jesli podlaczono telefon przez ADB, automatycznie przekieruj port 8080 -> telefon.
if command -v adb >/dev/null 2>&1; then
  if adb get-state >/dev/null 2>&1; then
    adb reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null 2>&1 && \
      echo "[ADB] Przekierowano tcp:${PORT} na podlaczony telefon (http://127.0.0.1:${PORT})" || true
  fi
fi

echo "============================================================"
echo " Kilometr API (tryb lokalny)"
echo "  Adres lokalny / Web PWA / ADB : http://127.0.0.1:${PORT}"
if [[ -n "$LAN_IP" ]]; then
  echo "  Adres w sieci Wi-Fi (telefon) : http://${LAN_IP}:${PORT}"
fi
echo "  Status / metryki              : http://127.0.0.1:${PORT}/v1/status"
echo "  Baza SQLite                   : ${DATA_DIR}/kilometr-delays.db"
echo "  Miasta pollingu               : ${CITIES:-wszystkie 120}"
echo "  Tryb demo (seed historii)     : ${SEED_DEMO}"
echo "------------------------------------------------------------"
echo "  Aby podpiac aplikacje lokalnie, ustaw w .env:"
echo "    EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:${PORT}"
echo "  (lub uruchom: EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:${PORT} npm run web)"
echo "============================================================"

export KILOMETR_HOST="0.0.0.0"
export KILOMETR_PORT="${PORT}"
export KILOMETR_DB_PATH="${DATA_DIR}/kilometr-delays.db"
export KILOMETR_LOG_JSON="false"
export KILOMETR_SEED_DEMO="${SEED_DEMO}"
if [[ "$NO_COLLECTORS" == "true" ]]; then
  export KILOMETR_ENABLE_COLLECTORS="false"
fi
if [[ -n "$CITIES" ]]; then
  export KILOMETR_ONLY_CITIES="${CITIES}"
else
  unset KILOMETR_ONLY_CITIES || true
fi
export RUST_LOG="${RUST_LOG:-kilometr_api=info,tower_http=info}"

if command -v cargo >/dev/null 2>&1; then
  exec cargo run --manifest-path "${SCRIPT_DIR}/Cargo.toml"
elif command -v nix >/dev/null 2>&1; then
  exec nix develop "${REPO_ROOT}#ci" -c cargo run --manifest-path "${SCRIPT_DIR}/Cargo.toml"
else
  echo "BLAD: nie znaleziono cargo ani nix w PATH." >&2
  exit 1
fi
