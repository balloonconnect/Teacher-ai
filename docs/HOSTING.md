# Hosting Karkai AI: which kind of server, and how

## Short answer
A **shared web-hosting plan** (the kind sold as "Node.js hosting, free domain, 50 GB NVMe", usually cPanel) is **probably not enough** for the full app. Check these four needs before you buy:

| The app needs | Why | Shared hosting usually |
|---|---|---|
| **PostgreSQL** (or SQLite for a tiny trial) | All data. The production code path is PostgreSQL | Offers MySQL only, no PostgreSQL |
| **Tesseract + Tamil data + poppler** | Reading scanned textbook pages (OCR). The Class 8 Tamil and Maths books are scanned | Cannot install system programs |
| **A long-running Node 22 process with ~1–2 GB RAM** | OCR and the AI tutor are heavy | Limits memory and kills long jobs |
| **Docker** (optional) | One command to run everything | Not available |

If a shared plan gives you PostgreSQL, Node 22 and shell access to install programs, it can work. Ask the host these four questions first. If any answer is no, use a VPS.

## Recommended: one small VPS with Docker
A VPS in India (Mumbai or Chennai) with **2 vCPU, 4 GB RAM, 40 GB disk**, running Ubuntu. Many providers sell this for a few hundred rupees a month. You get root access, so Docker, PostgreSQL and OCR all work.

### First-time set-up
1. Point your domain's A record at the server's IP address.
2. Install Docker (https://docs.docker.com/engine/install/ubuntu/) and open ports 80 and 443 in the firewall.
3. Get the code: `git clone https://github.com/balloonconnect/Teacher-ai.git /srv/karkai && cd /srv/karkai`
4. `cp .env.prod.example .env.prod`, then edit it. Set `DOMAIN`, `PUBLIC_URL` and a long random `POSTGRES_PASSWORD`. Add the AI, speech and email keys when you have them.
5. Start it: `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build` (the first build takes several minutes).
6. Create the first admin: `docker compose -f docker-compose.prod.yml --env-file .env.prod exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='ChooseA-LongPassw0rd' app node_modules/.bin/tsx scripts/create-admin.ts`
7. Open `https://your-domain`, sign in as admin, go to **Class books** and upload the Class 8 books.

HTTPS certificates are fetched and renewed automatically by Caddy.

### Everyday
| Task | Command |
|---|---|
| See logs | `docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f app` |
| Update to new code | `git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build` |
| Back up | `./scripts/backup.sh` (database + books, keeps 14 days) |
| Daily backup | cron: `0 2 * * * cd /srv/karkai && ./scripts/backup.sh` |

Copy the `backups/` folder off the server regularly. If the server dies, backups on the same disk die with it.

## Alternatives
- **Platform as a service** (Render, Railway, Fly.io): they run the Dockerfile and give a managed PostgreSQL. Use `STORAGE_DRIVER=s3` with a bucket (see DEPLOYMENT.md), because their disks may reset.
- **Vercel** only hosts the browser demo (UI-preview mode, no backend). It cannot run this server.

## What has not been tested
- The production compose file is checked for valid syntax only. **The image has not been built or started here** (no Docker engine in the build environment), so the first real start on your server is the first full test.
- No live AI model, Azure voice or email provider has been run. Keys go in `.env.prod` and nowhere else.
- The Tamil OCR download inside the Docker build can fail on a bad network. The build then keeps the packaged Tamil data (lower accuracy) and says so.
- Hosting the official textbooks needs the rights holder's permission. See DEPLOYMENT.md.
