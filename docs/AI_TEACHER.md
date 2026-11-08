# Karkai AI Teacher (free, local)

A Samacheer Kalvi teacher that runs on your own machine: Ollama for the model, your uploaded class textbooks as the only source of facts. No paid API is needed.

## What a student gets
- **Six modes:** Learn, Doubt, Homework, Exam prep, Revision, Voice. Language: தமிழ், English, or both. In the Voice mode only there is also Tanglish (Tamil written in English letters; spoken with the English voice).
- **Learn mode** teaches one idea as hook → concept → picture → example → key points → one check question. A right answer earns one harder mastery question, then a summary. A wrong answer is re-taught in a simpler way with a different example; after three misses the book's own text is shown and the topic is marked for practice. A question asked during a check is treated as a doubt, not a wrong answer.
- **Page citations.** Every reply lists the book pages it used, linked to the book viewer. If the books do not contain the answer the teacher says so and does not call the model. It never invents pages.
- **Level adaptation.** Beginner / developing / intermediate / advanced is worked out from the student's own quiz and check answers (smoothed accuracy; fewer than two answers is always "beginner"). Mastery needs the last three answers right and a score of at least 80%.

## Install
```bash
# 1. model (any machine; CPU is fine, but slower)
ollama pull qwen3:4b          # or gemma3:4b
# 2. app
cp .env.example .env          # set LLM_PROVIDER=ollama (and LOCAL_ONLY=1 to forbid hosted APIs)
npm install && npm run dev
# 3. upload the class textbooks (Teacher/Admin > Class books), by class and subject
```
Docker: `docker compose --profile ai up` starts the app with an Ollama container. Health: `GET /api/teacher/health` (also shown on the Status page). If Ollama is down the student sees a notice and the real textbook text instead of an answer.

### Voice (optional, free)
- **Listening:** run any OpenAI-style Whisper server (faster-whisper-server, whisper.cpp server) and set `STT_URL`. Without it the browser's own speech recognition is used where available.
- **Speaking:** set `TTS_URL` (any OpenAI-style speech server, e.g. a local Piper wrapper) or Azure. Without it the browser voice is used. Tamil voice quality depends on the device; test it with a Tamil teacher.

## API (all under `/api`, signed-in student, CSRF header on writes)
| Route | Purpose |
|---|---|
| `POST /teacher/chat` | One teaching turn, JSON reply |
| `POST /teacher/stream` | Same, as server-sent events: `status`, `delta`, `done` (`error` on failure) |
| `POST /teacher/quiz`, `/evaluate` | Quiz from the textbook; answers are kept on the server and marked there; single use |
| `POST /teacher/reteach`, `/revision` | Teach again; quick revision of a topic |
| `GET/DELETE /teacher/conversations[/:id]`, `GET/POST/DELETE /teacher/saved` | History and saved lessons |
| `POST /teacher/voice/transcribe`, `/voice/speak` | Local Whisper in, local TTS out (501 with a plain message if not configured) |
| `GET /student/progress`, `/student/learning-history` | Own data; a linked parent, teacher or school admin may pass `?studentId=` |

Safety: input is validated and capped (1,500 characters); conversations belong to one student (others get 404); rate limited per student; every model call has a timeout and is cancelled when the student stops or leaves; book text is stripped of instruction-like lines and passed as data, never as instructions; errors never expose stack traces.

## Testing
`npx vitest run tests/ai-teacher.test.ts` uses a scripted fake model, so it needs no Ollama. It covers the state machine, citations, no-source honesty, model-down fallback, privacy between students, SSE, quizzes and voice routes. Before going live also run `node scripts/ollama-bench.mjs` on the real machine and have a Tamil teacher read the Tamil answers.

## Production notes
- Ollama answers one request at a time by default (`OLLAMA_CONCURRENCY`); on a CPU a lesson can take a minute. Raise `TEACHER_TIMEOUT_MS`, and measure how many students you can serve instead of assuming.
- Keep `LOCAL_ONLY=1` so a stray API key can never send student questions to a hosted provider.
- Back up the database: progress and conversations live in tables `teacher_conversations`, `conversation_messages`, `student_topic_mastery`, `student_learning_progress`, `student_quiz_attempts`, `student_weak_topics`, `saved_lessons`.

## Not built yet
- **Embeddings.** Retrieval is keyword-based (BM25-style) over `textbook_pages`. That works well when the question uses the book's words and less well for paraphrases. To add vectors: embed passages with `nomic-embed-text` or `bge-m3` through Ollama, store them (JSON now, pgvector on Postgres), and blend cosine score with the keyword score inside `textbookHits`.
- The mic button records up to 30 seconds and sends it after you stop; it does not stream audio live.
