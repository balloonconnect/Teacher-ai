#!/usr/bin/env bash
# One-command first-time set-up on a fresh Ubuntu 22.04/24.04 VPS (run as root or with sudo).
#   curl -fsSL https://raw.githubusercontent.com/balloonconnect/Teacher-ai/main/deploy/bootstrap.sh -o bootstrap.sh
#   sudo DOMAIN=karkai.example.in bash bootstrap.sh
# Before running: point the domain's A record at this server's IP and open ports 80 and 443.
# It never asks for or stores any key: add AI / speech / email keys to /srv/karkai/.env.prod afterwards.
set -euo pipefail
: "${DOMAIN:?run as: sudo DOMAIN=your.domain bash bootstrap.sh}"
APP_DIR="${APP_DIR:-/srv/karkai}"
REPO="${REPO:-https://github.com/balloonconnect/Teacher-ai.git}"

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null 2>&1 || (apt-get update && apt-get install -y git)

if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone "$REPO" "$APP_DIR"; fi
cd "$APP_DIR"

if [ ! -f .env.prod ]; then
  cp .env.prod.example .env.prod
  PW="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
  sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|; s|^PUBLIC_URL=.*|PUBLIC_URL=https://${DOMAIN}|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PW}|; s|no-reply@karkai.example.in|no-reply@${DOMAIN}|" .env.prod
  chmod 600 .env.prod
  echo "Created $APP_DIR/.env.prod (random database password generated)."
fi

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# Daily backup at 02:00 (copy backups/ off this server regularly).
( crontab -l 2>/dev/null | grep -v 'scripts/backup.sh' ; echo "0 2 * * * cd $APP_DIR && ./scripts/backup.sh >> $APP_DIR/backups.log 2>&1" ) | crontab -

echo
echo "Running. Next:"
echo "  1. Add your AI key to $APP_DIR/.env.prod (see Option A/B inside), then:"
echo "       cd $APP_DIR && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
echo "  2. Create the first admin:"
echo "       docker compose -f docker-compose.prod.yml --env-file .env.prod exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='ChooseA-LongPassw0rd' app node_modules/.bin/tsx scripts/create-admin.ts"
echo "  3. Open https://${DOMAIN}, sign in as admin, upload textbooks under Class books."
