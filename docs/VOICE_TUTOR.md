# Voice tutor (Karkai AI → interactive tutor)

## 1. Audit of the repository (before this change)
- **Framework:** Vite + React 18 + TypeScript front end; Express + `node:sqlite` back end (`server/`); Vitest + supertest tests; deployed on Vercel in browser-only UI-preview mode, or as a Node server (`npm start`) serving `dist/`.
- **Existing AI:** `server/services/tutor.ts` — a labelled, rule-based development tutor (equation solver, lesson/textbook retrieval, check questions) behind a `TutorProvider` interface, with an optional Anthropic provider (`ANTHROPIC_API_KEY`). Chat is request/response (`POST /api/tutor/conversations/:id/messages`), no streaming.
- **Existing voice:** `src/components/voice.ts` — one-shot read-aloud and one-shot dictation using the browser's Web Speech API. No conversation loop.
- **Reusable:** auth + CSRF + rate limiting (`server/security.ts`), `ai_usage` + daily limits, under-13 guardian check, lesson/textbook retrieval (`retrieval.ts`, `textbookHits`), solver, grading, practice question bank, `useLoad/Card/Badge` UI kit, language context.
- **Missing (now added):** a voice session, one-step-at-a-time teaching state, streaming turns, interruption, per-session persistence/resume, latency metrics, request gate/queue.

## 2. Architecture implemented
```
Browser (Web Speech API: mic → text, text → speech)          Server
  Voice page ──POST /api/voice/sessions/:id/turn (SSE)──────► voiceRoutes  ──► TeachEngine (ruleEngine)
  highlight + speak each chunk as it arrives                    │  gate (max concurrency, queue, 503 when busy)
  abort fetch + cancel speech on interrupt                      │  per-session in-flight lock (409), rate limit, daily limit
  metrics: stt / first_text / first_audio / full ───────────────► voice_metrics (no conversation text)
                                                                 └─ voice_sessions (state), voice_turns (transcript if allowed), voice_quiz
```
- **Hybrid/local-first seam:** `TeachEngine` (`server/services/teach.ts`) yields `ack → chunk* → done`. The default `ruleEngine` needs no model. To use an LLM or a local GPU stack, implement `TeachEngine` (stream chunks of `{kind, en, ta, say, step}`), and pass it as `voiceEngine` to `createApp`. Provider code never reaches the browser; API keys stay server-side.
- **Speech runs in the browser** (SpeechRecognition + speechSynthesis). No audio is sent to our servers. A real-time voice provider (WebRTC) is **not implemented**: `POST /api/voice/realtime-token` returns 501. It would need a provider choice, server-minted short-lived credentials, and a CSP `connect-src` change.
- **Local-first (A) — not implemented:** would mean running Whisper-class STT, an LLM server (e.g. vLLM/llama.cpp) and a Tamil-capable TTS on a GPU box behind an authenticated internal endpoint, wrapped in a `TeachEngine`; the existing `Gate` already provides the concurrency limit and queue.

### Teaching engine (rule-based)
Modes: **Teach me** (one step, then a check question; yes/no, fill-the-blank or "what is x?"; wrong → hint → answer), **Explain fully** (all steps + summary), **Give me a hint** (progressive hints; the answer only at the end), **Practice with me** (question bank, hint after first miss, answer after second), **Revise this topic** (key points + 3-question quiz). Sources are labelled: class lesson, class textbook page (own class only, with "Open book, page N"), or "worked out by the equation solver (not from a textbook)". With no verified source it says so and cites nothing. Equations stay on screen; the spoken form is converted ("3x + 5 = 20" → "3 x plus 5 equals 20").

## 3. Files
- Server: `server/services/teach.ts` (engine), `server/routes/voice.ts` (API, gate, metrics), `server/db.ts` (+4 tables), `server/app.ts` (mount, injectable engine), `server/services/tutor.ts` (exports reused helpers).
- Client: `src/pages/voice.tsx`, `src/components/speech.ts`, `src/styles/global.css` (`.vt-*`), `src/App.tsx` (`/app/voice`), `src/components/Shell.tsx` (nav), `src/api.ts` (`getCsrf`).
- Tests: `tests/voice.test.ts` (17), browser run `docs/` notes below.

## 4. Install, configure, deploy
```
npm install
cp .env.example .env            # SEED_DEMO=1 only for local demos
npm run build                   # NOTE: .env.production sets VITE_UI_PREVIEW=1 (Vercel preview).
VITE_UI_PREVIEW=0 npx vite build   # real-backend build served by Express
npm start                       # NODE_ENV=production tsx server/index.ts
```
Optional env: `VOICE_MAX_CONCURRENCY` (default 8), `VOICE_QUEUE_MS` (default 8000). The per-student daily limit is the `voice_daily_limit` row in `settings` (default 150 turns). The Vercel deployment is browser-only UI preview: the voice page there shows an explanation instead of a lesson, because there is no engine or database. The voice tutor needs the Node server (and persistent disk or a managed database for SQLite).

## 5. Testing performed
- `npm test`: 91 tests pass (17 new in `tests/voice.test.ts`): Tamil/English/bilingual teaching, step-by-step + check, wrong answer → hint → answer, simpler explanation, progressive hints, practice, revise, honest no-source reply, class-scoped sources, voice→text switching + resume after refresh, transcript opt-out + delete, SSE streaming + client disconnect (state not advanced), duplicate request 409, queue 503, daily limit, student isolation, concurrent students, metrics without conversation content, realtime provider 501.
- Browser run (Playwright, real built app + real server, **speech APIs stubbed** because the headless test browser has no microphone or voices): bilingual step display, spoken text incl. equation wording, mic start, voice answer advancing a step, **interrupt cancels speech**, pause/resume/mute/slower/replay, wrong→hint→right answer, refresh restores transcript, offline → retry banner → automatic resend on reconnect, honest no-source, 375 px layout without overflow, text-only fallback with no speech APIs, no console errors. Not tested: real microphones, real Tamil voices, iOS Safari, real network latency, many real devices.
- **Latency (local rule engine, localhost, stubbed TTS): first text ≈ 13–18 ms, first audio event ≈ 40–50 ms, full answer ≈ 15–20 ms.** These do not predict LLM or real-TTS latency; with a hosted model expect first text to be dominated by model time-to-first-token.

## 6. Known limits
- Rule-based, not a language model: it cannot teach arbitrary questions; it only uses your lessons, class textbook pages and the equation solver.
- Tamil speech depends on the device having a Tamil voice/recognizer; otherwise Tamil is shown as text only (the page says so). iOS Safari support for speech recognition is limited.
- Voice interruption relies on the browser hearing the student over the tutor's own voice; headphones recommended.
- No diagrams/tables/KaTeX: equations are shown as plain Unicode text in a monospace chip.
- Voice transcripts are stored as plain text in SQLite when the student allows it; delete from the page.

## Reference images and visual learning

**What is implemented.** Original diagrams drawn in code as SVG (`shared/visuals.ts`), shown inside the tutor transcript next to the step they explain:
human heart (four chambers and blood flow, with a simple variant), reflection of light (ray diagram, angle i = angle r), right-angled triangle (a² + b² = c²),
an equation balance that changes with each solving step, and the graph of y = mx + c. Labels are bilingual (Tamil / English / both).

- Detection: `detectKey()` looks for the topic in the student's question (English and Tamil). Conversational text gets no image. Nothing is shown "to fill space".
- Retrieval is separate from answer generation: the voice route calls `visualsFor()` after each chunk inside try/catch and sends a separate `visual` event. If it throws, the lesson continues (tested; a `visual_error` metric is recorded).
- API: `GET /api/visuals/svg/:id?lang=&hl=&lvl=&p=` serves the SVG with `ETag` + `Cache-Control: max-age=3600` and a locked-down CSP. All parameters are validated against an allow-list.
- UI: `VisualCard` — title, caption, source and licence, "Not yet teacher-reviewed" tag, View larger (full-screen dialog with zoom), Hide image / Show diagram, loading skeleton, error state, alt text, and the follow-ups "Explain this diagram", "Simpler diagram", "What do the labels mean?".
- Follow-ups are handled by the teaching engine using `state.visual`; if no diagram is on screen it says so.
- Persistence: visual metadata is stored with the saved transcript, so a resumed lesson shows the same diagrams.
- The UI preview (Vercel) uses the same module and draws diagrams in the browser.

**Not implemented (be aware).**
- Source priority 1, 2 and 4: no textbook illustration extraction, no web/licensed image repositories, no AI-generated images. `ImageProvider` in `server/services/visuals.ts` is the seam; `safeImageUrl()` (https only, approved hosts via `VISUAL_IMAGE_HOSTS`, no credentials/ports/IP literals/private ranges) is ready and tested, but no provider uses it yet. Any provider that downloads must also use the pinned-IP fetch in `ssrf.ts`.
- No geography maps or history images, and no chemistry structures — nothing was drawn for them rather than risk wrong labels.
- No image upload / photographed textbook question: the rule-based engine has no vision model.
- Diagram labels and science content are written by the developer and have **not been reviewed by a teacher**; the UI says so. Have a subject teacher review before calling them reliable.
- The classic AI Tutor chat page does not show diagrams yet (only the Voice Tutor does).
- "Highlight the relevant part" works when the student names a label (e.g. the aorta); it is not tied to each spoken sentence.

## Two-way voice, AI voice playback and instant replay

**Speech to text** is still the browser's (Web Speech API): the student's voice never reaches our servers. New: "Let me check and edit what I said before sending" (recognised text goes into the box instead of being sent), and push-to-talk (hold the button or Space/Enter) for noisy rooms. Tamil / English recognition depends on the device; Tamil-English mixed speech is not handled by the browser recogniser — pick the language you will speak in.

**AI voice (optional).** Set `TTS_URL` (and `TTS_API_KEY`, `TTS_MODEL`, `TTS_VOICE_EN`, `TTS_VOICE_TA`, `TTS_FORMAT`) on the server. The browser calls only `POST /api/voice/tts`; the key never leaves the server. The server checks the session belongs to the student, applies rate limits, a per-student daily character allowance (`VOICE_TTS_DAILY_CHARS`), a concurrency gate and a timeout, keeps a small in-memory LRU so identical sentences are generated once, and stores no audio. The reply text (not the student's voice) goes to the TTS provider, and `/voice/config` says so to the student. Without `TTS_URL` the tutor speaks with the browser voice. `server/services/tts.ts` holds the `TtsProvider` interface; `httpTts` speaks the common `POST {model,input,voice,response_format}` → audio shape.

**Playback.** Each tutor message is cut into short sentences; all are requested in parallel and played in order, so audio starts after the first sentence. Controls: replay (per step, per full answer, last step), pause/resume, skip, speed 0.75–1.5× (applied to the player, no regeneration), mute. Starting to speak interrupts the tutor; double presses never overlap audio. Failed audio leaves the text visible and offers "Retry audio".

**Instant replay.** `CloudSpeaker` keeps every sentence's audio in a session cache (`shared/audioCache.ts`, key = conversation:message:segment:language, LRU by bytes, default 24 MB via `VOICE_AUDIO_CACHE_MB`) and releases it when the lesson ends or the page closes. Replay uses the cached clip: no language-model call, no new voice request. Replay does not stop an answer that is still being generated.

**Measured (this machine, headless Chromium, mock TTS server with 700 ms delay, 0.8 s tone):** replay started in 19 ms from cache; after replay-step, replay-full-answer and repeated replays the counts of turn requests and provider requests were unchanged (1 and 6 → 6). This is not a guarantee for other devices; the page shows the measured replay time and records `replay_cached` / `replay_local` metrics.

**Limits.** No real TTS provider was available, so only the mock server (and unit tests against it) was exercised — never a real Tamil or English AI voice. With browser voice (no `TTS_URL`) the browser cannot hand us its audio, so Replay speaks the text again locally: no model call and no network, but it is re-synthesised, not the identical audio. Sentence-level highlighting is not done (step level is). A true streaming real-time speech provider (WebRTC) is still not implemented. The Vercel preview has no server, so it always uses browser voice.

## 9. Real tutor model and Azure voice (production hookup)

**Tutor model** — `server/services/llmEngine.ts`, selected at start-up when `ANTHROPIC_API_KEY` (or `LLM_PROVIDER=openai` + `LLM_BASE_URL`) is set. The start-up log says which tutor is running.
- The model writes the **lesson plan** (3–5 short bilingual steps, each citing numbered sources, optional fill-in-the-blank checks). The existing teaching loop then speaks it step by step, asks the checks, gives hints, shows diagrams and caches the audio for instant replay — so none of those features depend on the model.
- **Sources** are retrieved first: the student's lesson, then pages of their own class's books (OCR'd text for scanned/Tamil books; Tamil word endings are stemmed so *பாறைகளில்* finds *பாறை*). No sources → no model call and an honest "I could not find this".
- **Enforced in code:** uncited steps are dropped; a fill-in-the-blank answer must literally appear in the step; both languages are required in bilingual mode; equations are solved by the deterministic solver, never the model; text in sources and in the student's question is delimited as data; any error, timeout (`LLM_TIMEOUT_MS`, default 25 s), empty or invalid reply falls back to the rule-based plan (and is logged without the content).
- **Privacy:** the provider receives the question text, the retrieved passages and the class level. No name, email or user id.
- **Not yet done:** token streaming (first speech waits for the whole plan), model-written answers to practice-question mistakes, and an evaluation set to measure answer quality and Tamil fluency. Do that against the live model before launch.

**Voice output** — `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` select Azure AI Speech (`azureTts` in `server/services/tts.ts`): SSML over the REST API, MP3 back, Tamil `ta-IN-PallaviNeural` and English `en-IN-NeerjaNeural` by default (override with `AZURE_SPEECH_VOICE_TA/_EN`). Everything built earlier applies unchanged: server-side key, per-session audio cache and instant replay, per-student daily character budget, concurrency cap, browser-voice fallback when the service fails.
**Voice input** stays the browser's speech recognition (Chrome sends the audio to Google). A server-side recogniser (Azure Speech-to-Text) would need a streaming audio path and is not built.
