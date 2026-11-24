#!/usr/bin/env bash
set -euo pipefail

# Prosty skrypt wdrozenia na VPS Mikrus 3.5.
# Uzycie lokalne na VPS:
#   ./deploy.sh
#   ./deploy.sh --with-caddy
# Uzycie zdalne z maszyny deweloperskiej (synchronizacja przez rsync + zdalny build):
#   DEPLOY_HOST=root@srvXX.mikr.us DEPLOY_PORT=10222 ./deploy.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_PROFILES=""

for arg in "$@"; do
  case "$arg" in
    --with-caddy) COMPOSE_PROFILES="--profile caddy" ;;
    *) echo "Nieznana opcja: $arg" >&2; exit 1 ;;
  esac
done

if [[ -n "${DEPLOY_HOST:-}" ]]; then
  REMOTE_DIR="${DEPLOY_DIR:-/opt/kilometr-api}"
  SSH_PORT="${DEPLOY_PORT:-22}"
  echo "Wysylam kod backendu do ${DEPLOY_HOST}:${REMOTE_DIR} (port ${SSH_PORT})..."
  ssh -p "$SSH_PORT" "$DEPLOY_HOST" "mkdir -p '$REMOTE_DIR'"
  rsync -az --delete \
    --exclude 'target/' \
    --exclude '.env' \
    --exclude 'backups/' \
    --exclude '*.db*' \
    -e "ssh -p $SSH_PORT" \
    "${SCRIPT_DIR}/" "${DEPLOY_HOST}:${REMOTE_DIR}/"

  echo "Uruchamiam zdalny build i restart kontenerow..."
  ssh -p "$SSH_PORT" "$DEPLOY_HOST" "cd '$REMOTE_DIR' && ./deploy.sh ${COMPOSE_PROFILES:+--with-caddy}"
  exit 0
fi

cd "$SCRIPT_DIR"

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "Utworzono domyslny plik .env z .env.example (dostosuj go do konfiguracji VPS)."
fi

echo "Buduje obraz Docker kilometr-api..."
docker compose $COMPOSE_PROFILES build api

echo "Uruchamiam kontenery..."
docker compose $COMPOSE_PROFILES up -d --remove-orphans

echo "Czekam na pozytywny healthcheck..."
for i in $(seq 1 30); do
  if docker compose exec -T api curl -fsS http://127.0.0.1:8080/health >/dev/null 2>&1; then
    echo "kilometr-api uruchomione poprawnie!"
    docker compose exec -T api curl -fsS http://127.0.0.1:8080/v1/status | head -c 400
    echo ""
    exit 0
  fi
  sleep 1
done

echo "BLAD: healthcheck nie przeszedl w 30 s. Ostatnie logi:" >&2
docker compose logs --tail=60 api >&2
exit 1
