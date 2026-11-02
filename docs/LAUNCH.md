# Launch checklist (the parts only the owner can do)

Everything else is built and tested. Each step below takes a few minutes.
**Never paste a key into code, an issue or a chat. The repo is public.**

## 1. AI model key (required)
**Free option:** create a Gemini key in Google AI Studio and put the four `LLM_*` lines from `.env.prod.example` in `.env.prod` (Option A there). Check the current free limits and data-use terms first: a free tier has request caps and may let the provider use prompts, so it suits a pilot, not thousands of students.
**Paid option:**
1. Sign in at console.anthropic.com, add billing, create an API key.
2. On the server, put it in `.env.prod`: `ANTHROPIC_API_KEY=...` (model name in `ANTHROPIC_MODEL`).
3. Set a monthly spend limit in the console.
Either way, run `npx tsx scripts/check-tutor.ts --limit 10` with the same variables once, and have a Tamil teacher read some real answers (step 6).

## 2. Textbooks (required for Class 8 content)
1. Confirm you may host them: check the licence/terms of the official Tamil Nadu free textbook downloads, or get written permission from the publisher.
2. Copy the PDFs to the server only (never GitHub): `docker compose -f docker-compose.prod.yml cp ./books app:/data/textbooks`.
3. Import with `scripts/import-textbook.ts` (see docs/HOSTING.md).

## 3. Server + domain (required)
1. One VPS, 2 CPU / 4 GB RAM, Ubuntu 24.04 (any provider; pick an India or Singapore region for speed).
2. Buy a domain; add an A record pointing to the server IP.
3. Follow docs/HOSTING.md "First-time set-up" (set `DOMAIN` and `POSTGRES_PASSWORD` in `.env.prod`).

## 4. Azure speech key (voice only; skip for a text-only launch)
1. Azure portal, create a "Speech" resource, region `centralindia`.
2. Copy Key 1 into `AZURE_SPEECH_KEY`.

## 5. Email key (optional at first)
1. Create an account at resend.com, verify your domain, create an API key.
2. Put it in `RESEND_API_KEY`.

## 6. Tamil teacher review
1. Send the teacher `docs/review/tamil-text-review.csv` (every Tamil string in the app, about 1,180 lines).
2. They mark each line Y/N and suggest a fix. Send the file back and the fixes get applied.
3. After the AI key is live, have them also read 20-30 real tutor answers before students use it.
