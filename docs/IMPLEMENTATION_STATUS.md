# Implementation status

> **Front end:** the student flow (lessons, tutor, material, practice, tests, results, certificates, verify) and the shared sign-up are present. Parent, teacher, school-admin and platform-admin screens are not in the UI. Route smoke-tested against the real server and in UI-preview mode; the earlier responsive/axe audits predate the latest changes.

Legend: **Verified** = covered by automated tests or exercised in a real browser. **Implemented** = built but not independently verified. **Not done** = absent.

| Area | Status | Evidence / note |
|---|---|---|
| Auth, sessions, CSRF, RBAC, tenant isolation | Verified | flow.test.ts |
| Registration, profile, under-13 guardian consent | Verified | flow.test.ts, units.test.ts |
| Lessons (Tamil/English/both) | Verified | browser; sample content |
| AI tutor chat | Verified (dev tutor) | browser + tests; live LLM path **Implemented** only |
| Learn from Your Material (PDF, URL, typed text) | Verified | tests + browser; SSRF blocked |
| Photo OCR / scanned-PDF OCR | Not done without key / Not done | see limitations |
| Practice centre | Verified | browser |
| Weekly tests: timer, autosave, submit, retake, review | Verified | timing.test.ts, browser |
| Manual review of written answers | Verified | flow.test.ts |
| Certificates: PDF (Tamil), QR, verify, revoke, reissue, audit | Verified | tests + browser |
| Parent / teacher / school / admin screens | Verified | tests + browser |
| Responsive 320–1920 | Verified | 376 combos, 0 horizontal overflow |
| Accessibility | Partly verified | 50 views, 0 serious/critical axe; no manual AT testing |
| Email/SMS, password reset, Postgres, OCR for scans | Not done | |

Tests: 31 passing. No integration is claimed beyond the table above.

## Mind Map (Learn page)

Status: implemented and tested (7 API/unit tests; browser-checked at 1280 and 375 px in UI-preview mode).

- Lesson page now has tabs: Explanation · Mind Map · Examples · Practice questions · Quick revision (`?tab=` in the URL).
- `GET /api/lessons/:id/mindmap` builds the map **from the lesson's own content** (no AI text, nothing invented), validates it with a zod schema (single root, unique ids, no cycles, size cap), and caches it by content hash. `defaultMode` is Simple for Classes 1–5.
- `PUT /api/lessons/:id/mindmap/state` and `GET /api/mindmaps/recent` store each student's understood / revise-later marks and recently viewed maps in the existing `settings` table (no migration); shared lesson content is never modified.
- UI: SVG map with zoom, pan, pinch, Fit, Reset, expand/collapse, search, Simple/Detailed/Quick-revision modes, Tamil / English / both, keyboard-focusable nodes, a detail panel, and links into the existing tutor (explain simply / in Tamil / in English / example / step by step / practice question).
- Export: PNG download, and Print / Save as PDF (via the browser print dialog).

Limits: maps are only as rich as the (sample) lesson content; there is no AI-generated map yet; "practice this branch" opens the tutor's practice action and the subject practice page, not branch-specific server questions; "save to learning materials" and sharing links are not implemented; in UI-preview mode marks live only in the browser tab.

## Textbook lessons (Class 8 English)

- `scripts/import-textbook.ts` turns an extracted textbook into short, source-labelled excerpts (`server/curriculum/*.json`). `server/curriculum.ts` loads them into new databases (seed) and adds or refreshes them in existing ones on every start without touching student data.
- Lessons show a "Textbook excerpt" badge and a source note; the tutor answers from the current lesson first and cites the textbook and starting page; mind maps are built from the same excerpt. Tests: `tests/textbook.test.ts`.

## Homepage, sign-in and dashboard pass

- Homepage (`/`), Features and How it works rewritten to describe only what exists (tutor, mind maps, practice, weekly tests, progress, own material); added an honest "what to know" section (independent, content still growing, AI can be wrong, child privacy).
- Sign-in (`/signin`): inline field errors with focus, labelled show/hide password, "Forgot password" page (honest: no email reset exists yet), redirect only to same-site `/app`, `/profile`, `/verify` paths (`src/lib/safeNext.ts`), already-signed-in visitors are redirected, network-error message. Server: login always runs one password hash so timing does not reveal which emails exist.
- Dashboard (`/app`): Ask Karkai AI box (opens the tutor with your question), Continue learning (+ "Open mind map"), four tool shortcuts with real counts, a Mind maps card (recent maps and your understood/revise counts), then the existing goals, subjects, tests, results and revision cards.
- Mind map: "Practise this branch" asks the tutor for questions about the whole branch. These are tutor-generated, not from the server question bank.

## Learning loop, tutor, resilience, security pass
Verified by tests (68 passing) and a 375 px browser check of the preview build (no overflow, no console errors):
- Learning loop links: lesson → "Practise this chapter" (`/app/practice?subject&chapter`, now honoured); wrong practice answers → "Explain my mistake" (tutor); Progress revision plan → lesson + mind map links built from real result snapshots.
- Tutor: Tanglish detection (conservative, 2+ common words, replies in both languages); "Worked example" and "Explain again" actions use the lesson's own example / real-life text. Listen-aloud already existed. The tutor is still rule-based unless `ANTHROPIC_API_KEY` is set.
- Network: request timeouts (15 s GET / 45 s write), GET retried twice, writes never auto-retried, offline banner.
- Security tests (`tests/security.test.ts`): auth required; cross-student access to conversations, materials, attempts and certificates denied; no answers leaked during an attempt; upload content-sniffing; idempotent server-side scoring and no forged score; no certificate for failed attempts; built bundle contains no API keys.

- Lesson page has a sixth **Textbook** tab: only the few book pages of the student's own class that relate to that lesson (excerpt + "Open page N in a new tab"), not the whole book. API: `GET /api/textbooks/for-lesson/:lessonId`.

## Class books (upload → class-scoped chatbot → open at cited page)
- Only the platform admin uploads/removes a PDF (class, subject, medium) at `/admin/books`; teachers get a read-only list at `/teacher/books` and the upload/delete API returns 403 for them. The server stores the PDF (`TEXTBOOK_DIR`, default `data/textbooks`) and per-page text.
- Students see/open only books of their own class (`/app/books`, `/app/textbook/:id?page=N`); other classes' books return 404 on list, file and page endpoints.
- The dev tutor answers from the student's class books (after the open lesson), shows "Open book, page N" links, and never searches other classes' books.
- Verified: `tests/textbooks.test.ts` (4) and a real-browser run (teacher upload → student question → click "Open book, page 2" (opens in a new tab) → viewer at page 2, no console errors, no overflow at 375 px). Total 72 tests pass.
- Not verified: the browser's inline PDF rendering (headless Chromium does not show a PDF viewer; a text-of-page panel and an "open in new tab" link are the fallback).

## Voice tutor
- `/app/voice`: voice + text tutor with five teaching modes, streaming turns, interruption, saved/resumable sessions, usage limits and latency metrics. See `docs/VOICE_TUTOR.md` (architecture, install, tests, honest limits). Default engine is rule-based; real-time/LLM/local-GPU providers are an interface, not implemented.
