# Free local AI teacher (Ollama)

Karkai AI can run its AI teacher on our own server with **Ollama**. No paid AI API, no key, and the question text never leaves the machine.

## Decisions (agreed)
- **Keep Vite + React + Express.** No Next.js rewrite; new `/api/teacher/*` routes are added to the existing Express server.
- **Runs on any machine.** Nothing assumes a GPU. Default model `qwen3:4b`, one model call at a time, short answers, a timeout, and the rule-based tutor as the fallback, so a slow computer still works.
- **Textbooks are uploaded by hand, class by class and subject by subject** (Admin → Upload class book). Search runs over those uploaded pages. Embeddings are optional and come later.

## Phase 1 — done in this change
- `LLM_PROVIDER=ollama` (native `/api/chat`, streaming), `OLLAMA_BASE_URL`, `OLLAMA_MODEL` (`qwen3:4b`, or `gemma3:4b`), `OLLAMA_KEEP_ALIVE`, `OLLAMA_CONCURRENCY` (default 1).
- `LOCAL_ONLY=1` refuses every hosted provider, even if a key is set.
- Thinking is switched off for Qwen3 and any `<think>` text is removed, so students never see it.
- Requests queue (one at a time by default) and can be cancelled while waiting.
- Admin status page shows if Ollama is reachable and whether the model is downloaded.
- `docker compose --profile ai up -d` adds an Ollama container; models are kept in the `ollamadata` volume. Existing volumes and variables are untouched.
- `node scripts/ollama-bench.mjs` measures speed on the actual machine for English, Tamil and both.
- The existing safeguards still apply: the model only sees retrieved textbook pages, cites them, and says so when nothing is found.

## Set it up
```
cp .env.example .env     # then set:  LLM_PROVIDER=ollama   LOCAL_ONLY=1   LLM_TIMEOUT_MS=60000
docker compose --profile ai up -d
docker compose exec ollama ollama pull qwen3:4b
node scripts/ollama-bench.mjs
```
Read the Tamil answer from the benchmark yourself (or ask a Tamil teacher). Do not choose `qwen3:4b` or `gemma3:4b` for live use until you have compared them on your own lessons. Do not rely on a promise of how many students can use it at once; measure it with the benchmark first.

## Phases 2–7
Phases 2–5 and the chat screen (7) are built: see [AI_TEACHER.md](AI_TEACHER.md). Phase 6 (embeddings) is **not built**; search uses the existing keyword ranking over the uploaded textbook pages, and AI_TEACHER.md says how to add vectors later.
