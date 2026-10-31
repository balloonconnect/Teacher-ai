# Deployment checklist

Karkai AI has two ways to run. Know which one you are looking at.

| | What it is | Backend | Use for |
|---|---|---|---|
| **UI preview** (Vercel today) | The front end with a recorded, in-browser fake API (`VITE_UI_PREVIEW=1`, set in `.env.production`) | none | Reviewing screens. Nothing is saved, graded or sent to a model. |
| **Live app** (this document) | One Node server: API + built front end | PostgreSQL, a file bucket, optional tutor model and voice | Real students |

The live app is **one container**. Vercel's serverless functions are not a good fit (long voice streams, background OCR, in-memory rate limiter), so keep Vercel for the preview and run the container on Render, Railway, Fly.io, Azure Container Apps, AWS App Runner/ECS, or any VM with Docker.

---

## 1. Accounts and keys to get

| Need | Why | Notes |
|---|---|---|
| **PostgreSQL** database | All app data | Managed is easiest: Neon, Supabase, Azure Database, AWS RDS. Version 14+. Region close to students (India). |
| **S3-compatible bucket** | Textbook PDFs and student uploads | AWS S3 (ap-south-1), Cloudflare R2, or Supabase Storage. Keep it **private**; the server streams files after checking the student's class. |
| **Tutor model key** | Real lessons written from the textbook | Anthropic (`ANTHROPIC_API_KEY`) or any OpenAI-compatible service (`LLM_BASE_URL`). Optional: without it the labelled rule-based tutor runs. |
| **Azure AI Speech** key + region | AI voice (Tamil + English) | Resource in `centralindia` keeps latency low. Optional: without it the student's browser voice is used. |
| **Email provider** | Password reset, email confirmation, guardian approval | Resend (`RESEND_API_KEY`) or any SMTP service. Verify your sending domain (SPF/DKIM) or mails land in spam. Optional: without it the app says email is off. |
| **Domain + HTTPS** | Sign-in cookies, microphone access | Browsers only allow the microphone on HTTPS. Most hosts give TLS for free. |
| **Textbook rights** | Hosting official books | Confirm with Tamil Nadu Textbook and Educational Services Corporation (TNTESCOP) that you may store and serve each book. Platform-admin uploads are your responsibility. |

## 2. Provision, in this order

1. **Database.** Create an empty database and a user. Copy the connection string → `DATABASE_URL`. Managed providers usually need `DATABASE_SSL=1`. The app creates its own tables on first start.
2. **Bucket.** Create a private bucket and an access key limited to it (read, write, delete). Set `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; for R2/MinIO also `S3_ENDPOINT`. No bucket → files go to a local folder on a persistent disk (fine for one server, lost if the disk is).
3. **Voice.** `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`. Defaults: `ta-IN-PallaviNeural`, `en-IN-NeerjaNeural`; change with `AZURE_SPEECH_VOICE_TA/_EN` after listening to the voices available in your region.
4. **Model** (also powers the Tamil language actions: correct, simplify, formal/conversational, translate). `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`), or `LLM_PROVIDER=openai` with `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.
5. **Email.** `MAIL_FROM`, then `RESEND_API_KEY` or `SMTP_HOST/PORT/USER/PASS`. Links use `PUBLIC_URL`, so set it first. Send yourself a reset mail before announcing; the Live set-up check shows whether email is on.
6. **App settings:** `NODE_ENV=production`, `PUBLIC_URL=https://your-domain` (used in certificate QR links), `SEED_DEMO=0`. See `.env.example` for every variable.

## 3. Build and run

```bash
docker build -t kavli .
docker run -p 3001:3001 --env-file .env kavli
```

The image includes Tesseract (English + Tamil) and poppler for scanned-book OCR. The `Dockerfile` builds the front end with `VITE_UI_PREVIEW=0`; if you build without Docker, build with that variable set or you will ship the fake-API preview.

Health check: `GET /api/health` → `{"ok":true}`. The start-up log line states the tutor in use (`tutor: rule-based` or the model name).

## 4. First-run steps

1. **Create the first admin** (production starts with no demo accounts):
   `ADMIN_EMAIL=you@org.in ADMIN_NAME="Your Name" npx tsx scripts/create-admin.ts` (run with the same `DATABASE_URL`). It prints a one-time password if you do not set `ADMIN_PASSWORD`. Sign in and change it.
2. **Upload the books** (Admin → Class books, or from a terminal: `ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run import-book -- book.pdf --class 8 --subject tamil --medium Tamil --url https://your-domain`). A Tamil-medium or scanned book opens at once and shows *"Reading N pages with OCR"*; the tutor can use pages as they finish. Measured on the Class 8 Tamil book (192 pages): about 2.4 s per page, 4–8 minutes in total, depending on CPU. Leave the server running; if it restarts, unfinished books resume.
3. **Check the chapters.** Admin → Class books → *Find chapters* reads the contents page; open the book in the student view and look at the Chapters list. Wrong titles or page ranges can be corrected with `PUT /api/textbooks/:id/chapters`. Then **check one book by hand**: open a few pages in the reader and ask the tutor a question that book answers. OCR is good but not perfect (spot-checking is the only quality control).
4. **Create the school, teachers and classes**, or let staff register and approve them on Admin → People. Check each request's school and email before approving: it gives access to students' work. The same screen resets a locked-out person's password.
5. **Check the real tutor model.** With your key set and the Class 8 Tamil book imported, run `npx tsx scripts/check-tutor.ts --limit 10`. It asks the real model the labelled book questions and prints: usable cited lessons, right page cited, Tamil present, refusals for questions the book cannot answer, fallbacks, and time to first step / whole plan. Read a few answers in the app too. Do this before any student uses it.
6. **Check the live set-up card.** Admin → Class books now starts with a *Live set-up check* (database, storage, OCR, tutor, voice, demo accounts, https) and counts of lessons, practice questions and books. Fix every *To do* before announcing. A production start already includes the built-in practice questions; teachers add more.

### Try the whole stack on your own computer first
`docker compose up --build` starts the app, PostgreSQL and an S3-compatible bucket the way production does, with demo accounts on. Then `npm run smoke` uploads a scanned PDF, waits for real OCR, signs up a student and checks the tutor cites the uploaded page. Without Docker: `npm run local:pg` gives a real PostgreSQL (see the README).

## 5. Go-live checklist

**Security**
- [ ] HTTPS only; `PUBLIC_URL` is the https address.
- [ ] `SEED_DEMO=0`; no `*@demo.kavli.local` users exist (`select email from users where is_demo=1` is empty).
- [ ] Secrets are in the host's secret store, not in the repo or image. `.env` is not committed.
- [ ] Bucket is private; database is not reachable from the internet except from the app.
- [ ] Rate limiting is in memory → **run one instance** (or add a shared limiter before scaling out).
- [ ] Decide the privacy position and tell families: with a tutor model on, each question and the textbook passages used to answer it are sent to that provider; no names, emails or ids are sent. With Azure voice on, the tutor's reply text is sent to Azure to be spoken. Student speech is recognised by the browser's own speech service (Chrome sends audio to Google). Update the privacy notice to match.
- [ ] Under-13 students: guardian approval is an emailed single-use link (3 to 7 days), which proves control of that mailbox only. Decide if that is enough for your school.

**Data**
- [ ] Automated daily database backups switched on, and a restore tried once.
- [ ] Bucket versioning or backup for the textbook files.
- [ ] Cost alerts on the model and speech accounts. The app limits voice synthesis per student per day (`VOICE_TTS_DAILY_CHARS`, default 20 000 characters) and concurrent requests (`VOICE_MAX_CONCURRENCY`).

**Quality before real students**
- [ ] A teacher reviews the Class 8 diagrams and the maths solver explanations. Diagrams are original drawings, not yet reviewed by a teacher.
- [ ] Listen to the Tamil voice on real sentences (numbers, equations, mixed English words) and pick the voice you prefer.
- [ ] Try the tutor with 10–20 real questions per subject. Look for answers that drift from the book. The tutor is built to show only cited steps and to say *"I could not find this in your books"* otherwise, but that has only been tested against a simulated model.
- [ ] Test on a real low-end Android phone on 4G: sign-in, a voice turn, replay, the diagram.
- [ ] Microphone permission flow on iOS Safari and Android Chrome. Browser speech recognition for Tamil varies by device.

**Operations**
- [ ] Log shipping and an uptime check on `/api/health`.
- [ ] A named person owns: the model/voice budget, textbook uploads, and student data-deletion requests (the student's *Delete my data* action removes their account, results and uploaded files).
- [ ] Rollback: keep the previous image tag. Schema changes are numbered migrations (`docs/MIGRATIONS.md`), applied on start; take a backup before a release that has one. With several instances set `MIGRATE_ON_START=0` and run `npm run migrate up` as a release step.

## 6. What has and has not been verified

Verified in this repository's test suite (238 tests, run on **SQLite and on real PostgreSQL 18**):
sign-in and roles, tests/results/certificates, voice tutor flow, instant replay, diagrams, textbook upload/OCR flow, retrieval, the tutor-model engine and its fallbacks, storage drivers, voice provider request format.

Verified on real data: the Class 8 Tamil PDF (192 pages) was imported end to end with real Tesseract OCR; its embedded text layer was found to be corrupted on essentially every page and was replaced by OCR output (see `KNOWN_LIMITATIONS.md`).

**Verified by CI on GitHub:** the Docker image builds; the Compose stack (app + PostgreSQL 16 + an S3-compatible mock) starts healthy; and the smoke test passes against it (real OCR in the image on a generated scan, bucket upload, student sign-up, cited tutor answer). **Verified locally on the real Class 8 Tamil book** (192 pages, PostgreSQL, real Tamil OCR, outside Docker): 39 chapters found, right page first in 75% of questions, top-3 92%. Not yet checked: the real book inside the image, a real S3/R2 bucket, a managed database.

**Not verified, because it needs your accounts or network:**
- Calls to the real Anthropic / OpenAI-compatible API, including their streaming (SSE) formats (tested against a mock server that follows their documented request and response shapes).
- Calls to real Azure AI Speech (mock server; voice names are Azure's published defaults and must be confirmed in your region).
- A real email provider (Resend is tested against a mock HTTP server; SMTP against an in-process server), including spam placement.
- A real S3/R2 bucket (tested with the AWS SDK against a mock S3 server).
- Managed Postgres with TLS (`DATABASE_SSL`), and load beyond the in-process tests.

Run these once on a staging copy before announcing.

## 7. Scaling notes

- One instance handles a classroom comfortably; the limits that bite first are the model/voice providers, not the database.
- To run several instances you need: a shared rate limiter, one OCR worker (set `OCR_ENGINE=off` on the others), and `STORAGE_DRIVER=s3` (not local disk).
- Retrieval reads each class's book pages from the database for every question (about 60–100 ms for a 192-page book). For many books, cache the per-book passage list, or add Postgres full-text search or embeddings; `topPassages` is the only ranking function to change.

## Tamil quality, font and voice

- **Font.** Noto Sans Tamil is bundled with the app (`@fontsource/noto-sans-tamil`, weights 400–700); nothing is fetched from Google Fonts, so it works offline. Fallbacks: Noto Sans Tamil UI, Nirmala UI (Windows), Latha, Vijaya, Tamil Sangam MN (Apple), then the system sans-serif. Class `.tamil-text` (and `:lang(ta)`, `.ta`) sets `line-height:1.8`, `letter-spacing:normal`, `word-break:normal`, `overflow-wrap:break-word`.
- **Scanned books.** The Docker image replaces the packaged Tamil OCR data with Tesseract's `tessdata_best` at build time (needs internet during `docker compose build`; if the download fails it keeps the packaged data and says so in the build log). Pages are read at 300 dpi; `OCR_DPI` and `OCR_PSM` tune this. **Books already imported keep their old text until you press "Read pages (OCR)" again or delete and re-import them.**
- **Language actions** (`/api/tamil/transform`) need the model from step 4. Without it the buttons are hidden and the API answers 501. Each action is one model call; results that drop a number, date or Latin name, are not Tamil, or are far longer/shorter than the source are rejected and the original text is kept.
- **Tamil voice** uses the AI voice from step 3 when configured (Azure `ta-IN-PallaviNeural` by default; `ta-IN-ValluvarNeural` is the male Tamil voice) and otherwise the browser's own `ta-IN` voice. It never falls back to an English voice. Text is read in pieces of at most 280 characters; audio for a repeated piece is served from a small in-memory cache. Daily per-user limit: `VOICE_TTS_DAILY_CHARS` (default 20000). Cost: Azure bills per character synthesised; check the current rate and free allowance on Azure's pricing page before launch.

## Textbook structure update
- New migration `2 item_ai` (additive table; applied on start; back up first as usual).
- After deploying, press **Re-read all pages** on each book (or re-run chapter sync) so lessons gain `content.structure`; old lessons keep working without it.
- Optional: set a model key (`ANTHROPIC_API_KEY` or `LLM_PROVIDER=openai`) to enable "Explain with AI" and "Suggest an answer (AI)".

## Show only the uploaded textbook (BOOK_ONLY)

Set `BOOK_ONLY=1` (already set in `docker-compose.yml`) to hide all built-in example content: sample lessons, sample weekly tests, practice questions, example homework and the "Sample content" badge. On start it also removes that content from an existing database. Uploaded textbooks, their lessons, users and student data are kept.
