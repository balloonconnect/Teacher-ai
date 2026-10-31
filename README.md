# Karkai AI (கற்கை AI) — Your Personal AI Teacher

A Tamil Nadu State Board (Samacheer Kalvi) AI tutor for Classes 1–12. *கேட்டு கற்போம். பார்த்துப் புரிந்துகொள்வோம். — Learn by Listening. Understand by Seeing.* The product was previously called Kalvi Mitra; the repository, database file (`data/kavli.db`), Docker names and demo logins keep the internal name "kavli" on purpose. The name and taglines live in `shared/brand.ts`, `index.html` and `public/manifest.webmanifest`.

A full-stack web app: an Express API (PostgreSQL in production, SQLite for development) and a Vite/React/TypeScript front end.
Students learn in Tamil / English / both, ask an AI tutor, learn from their own material,
practise, take weekly tests, and earn verifiable PDF certificates. Parents, teachers,
school admins and platform admins have their own screens.

> **Status:** honest status is in [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md);
> gaps in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md). This is not an official
> Tamil Nadu Government product; bundled curriculum content is sample content.

## Current scope (trimmed UI)
The web app exposes the student flow from the Figma “Flow 1” page — public pages, one shared **/signup** (Student / Parent / Teacher / School admin fields on the same page), **/signin** (`/login` redirects), student dashboard, lessons, AI tutor, Learn from Your Material, practice, weekly tests, results, certificates, verify page, progress, bookmarks and settings. Parent, teacher and school-admin accounts can register but only see a holding page; teacher and school-admin requests stay `pending` until a platform admin approves them (`GET /api/admin/role-requests`, `PATCH /api/admin/users/:id`). The parent/teacher/school/admin screens are not in the front end (still in git history, commit a4ede4c). The server API and tests for those features remain, but they have no UI now. Public pages still describe the full product and should be edited to match.

## UI-preview mode (no backend)
`.env.production` sets `VITE_UI_PREVIEW=1`, so production builds (e.g. on Vercel) run entirely in the browser with a fixed demo login and canned tutor replies (`src/preview.ts`). Lessons, tests, results, certificates (incl. a real generated PDF), practice and the material screens replay responses recorded from the real API (`npx tsx scripts/record-preview.ts` → `src/preview-data.json`, `public/preview/certificate.pdf`); answers you enter are not graded in preview, the recorded passing result is shown. Nothing is stored on a server. **Delete `.env.production` (or set it to 0) once the real backend is hosted.**

## Run it on your computer
Needs **Node 22+** (and optionally Docker). Pick one:

| Way | Commands | You get |
|---|---|---|
| **A. Fastest** (SQLite, no extras) | `npm install` then `npm run dev` | API :3001 + web :5173 (open http://localhost:5173). Demo accounts. Rule-based tutor. |
| **B. Like production** (Docker) | `docker compose up --build` | App :3001 + PostgreSQL + an S3-compatible bucket, Tesseract OCR inside the image. |
| **C. Postgres without Docker** | terminal 1: `npm run local:pg`; terminal 2: `npm run build` then `DATABASE_URL=postgres://postgres:pw@localhost:54329/kavli SEED_DEMO=1 npx tsx server/index.ts`, and open http://localhost:3001 | A real PostgreSQL via the embedded dev binaries. |

Copy `.env.example` to `.env` to switch on the real services (tutor model key, Azure voice, email). Everything is optional; without a key the labelled rule-based tutor and the browser voice are used.

**Check that it works end to end** (server running): `npm run smoke`. It uploads a scanned PDF, waits for real OCR, signs up a student, asks the tutor, and checks the answer is cited to the uploaded page.

**Add a real textbook** (server running; admin account): `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run import-book -- path/to/book.pdf --class 8 --subject tamil --medium Tamil`. The same thing is available in the app at Admin -> Class books.

**Check the real tutor model** once you have a key: `ANTHROPIC_API_KEY=... npx tsx scripts/check-tutor.ts --limit 10`.

## Scripts
| Script | Purpose |
|---|---|
| `npm run dev` | API (tsx watch) + Vite together |
| `npm run build` / `npm start` | production front-end build to `dist/` / production server (API + `dist/`) |
| `npm run lint` / `npm run typecheck` | ESLint (bug-finding rules) / front-end + server type-check |
| `npm test` / `npm run coverage` | vitest (234 tests; `node scripts/test-pg.mjs` runs them on PostgreSQL) / with a coverage report |
| `npm run smoke` / `npm run import-book` | end-to-end check of a running server / add a textbook PDF |
| `npm run migrate -- status` | database migration status (`docs/MIGRATIONS.md`) |
| `npm run local:pg` | a local PostgreSQL without Docker |

## Demo accounts (development only, password `demo@12345`)
`meena@demo.kavli.local` (student), `parent@`, `teacher@`, `school@`, `admin@demo.kavli.local` (platform admin), and the older usernames such as `vikikalvi`. Set `SEED_DEMO=0` in production so none of these are created.

## What is real and what is not
Real and tested here: sign-in and roles, tests/results/certificates, textbook upload with real OCR (Tamil + English), chapters, retrieval measured on the real Class 8 Tamil book, admin People screen, email (against mock servers), migrations, PostgreSQL and SQLite, CI.
Needs your accounts and has **only been tested against mocks**: the tutor model, Azure voice, S3, Resend/SMTP. See [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) before putting real students on it.

## Architecture
- `server/` — Express app (`app.ts`), SQLite (`db.ts`), auth/CSRF/rate limit (`security.ts`),
  routes per role, services (`grading`, `tests`, `certificatePdf`, `ssrf`, `retrieval`, `solver`, `tutor`).
- `src/` — React app, route guards (UI only; the server re-authorises every request), pages per role,
  bilingual `Bi` component, responsive shell with bottom nav on mobile.
- `tests/` — vitest + supertest. `e2e/` — Playwright scripts for responsive overflow and axe a11y.

## Key behaviours
- Server-side auth (scrypt hashes, httpOnly session cookie, CSRF token), RBAC, tenant isolation.
- Under-13 registration requires guardian consent.
- Tests: server-authoritative timer, idempotent start/submit, immutable attempts, answer keys never sent before submit, manual review of written answers.
- Certificates: A4 landscape PDF with Tamil text, QR + public verify page (minimal data), revoke/reissue with reasons and audit trail.
- Learn from Your Material: private storage, magic-byte checks, SSRF-safe URL fetch, material treated as untrusted text.

Docs: [DEPLOYMENT](docs/DEPLOYMENT.md) · [TESTING](docs/TESTING.md) · [MIGRATIONS](docs/MIGRATIONS.md) · [VOICE_TUTOR](docs/VOICE_TUTOR.md) · [KNOWN_LIMITATIONS](docs/KNOWN_LIMITATIONS.md) · [IMPLEMENTATION_STATUS](docs/IMPLEMENTATION_STATUS.md).
