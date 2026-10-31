import { Router } from 'express';
import { z } from 'zod';
import { DB, q } from '../db';
import { rateLimit } from '../security';
import { iso } from '../clock';
import { parse, wrap } from '../http';
import { HttpError } from '../services/tests';
import { AudioLru, TtsError, TtsProvider, ttsFromEnv } from '../services/tts';
import { LlmClient, llmClientFromEnv } from '../services/llmEngine';
import { MAX_TAMIL_INPUT, TAMIL_ACTIONS, TamilAiError, transformTamil } from '../services/tamilAi';
import { chunkText, normalizeTamil } from '../services/tamilText';

/**
 * Tamil tools for any signed-in user: language actions (model) and Tamil speech (server voice). Both are optional services:
 * without a configured model or voice the endpoints say so plainly, and the browser's own Tamil voice (if any) still works.
 * Keys stay on the server.
 */
export function tamilRoutes(db: DB, opts: { llm?: LlmClient | null; tts?: TtsProvider | null } = {}) {
  const r = Router();
  const llm = opts.llm === undefined ? llmClientFromEnv() : opts.llm; const tts = opts.tts === undefined ? ttsFromEnv() : opts.tts; const lru = new AudioLru();
  const budget = () => Number(process.env.VOICE_TTS_DAILY_CHARS ?? 20000);
  const used = async (userId: string, kind: string) => (await q.get<any>(db, "SELECT COALESCE(SUM(input_chars),0) n FROM ai_usage WHERE user_id=? AND kind=? AND substr(at,1,10)=?", userId, kind, iso().slice(0, 10)))!.n as number;
  r.use((req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in.'))));

  r.get('/config', wrap(async (req, res) => res.json({
    llm: { enabled: !!llm, provider: llm?.name ?? null, maxChars: MAX_TAMIL_INPUT, actions: TAMIL_ACTIONS },
    tts: { enabled: !!tts, provider: tts?.name ?? null, locale: 'ta-IN', maxChars: 500, dailyChars: budget(), usedChars: await used(req.user!.id, 'tts') },
  })));

  r.post('/transform', rateLimit(30, 60000, req => `tamil:${req.user?.id ?? req.ip}`), wrap(async (req, res) => {
    const b = parse(z.object({ action: z.enum(TAMIL_ACTIONS), text: z.string().max(MAX_TAMIL_INPUT * 2), audience: z.string().max(60).optional() }), req.body);
    if (!llm) throw new HttpError(501, 'The Tamil language service is not set up on this server (no AI model key is configured). Your text is unchanged.');
    const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    try {
      const out = await transformTamil(llm, { action: b.action, text: b.text, audience: b.audience, signal: ac.signal });
      await q.run(db, 'INSERT INTO ai_usage(user_id,provider,kind,input_chars,output_chars,at) VALUES (?,?,?,?,?,?)', req.user!.id, llm.name, 'tamil_text', b.text.length, out.text.length, iso());
      res.json(out);
    } catch (e) { if (e instanceof TamilAiError) throw new HttpError(e.status, e.message); throw e; }
  }));

  /** Speech for ONE chunk (≤500 chars). The client splits long text with /chunks and plays the pieces in order. */
  r.post('/chunks', wrap(async (req, res) => { const b = parse(z.object({ text: z.string().max(20000) }), req.body); const text = normalizeTamil(b.text); res.json({ chunks: chunkText(text, 280), chars: text.length }); }));
  r.post('/tts', rateLimit(180, 60000, req => `tamiltts:${req.user?.id ?? req.ip}`), wrap(async (req, res) => {
    if (!tts) throw new HttpError(501, 'No AI Tamil voice is configured on this server. Your browser’s Tamil voice is used when the device has one.');
    const b = parse(z.object({ text: z.string().max(2000) }), req.body); const text = normalizeTamil(b.text).replace(/\n+/g, ' ');
    if (!text) throw new HttpError(400, 'There is no text to read.'); if (text.length > 500) throw new HttpError(413, 'Send long text in pieces of 500 characters or fewer.');
    const k = AudioLru.key(text, 'ta'); let hit = lru.get(k); let cached = true;
    if (!hit) {
      if ((await used(req.user!.id, 'tts')) + text.length > budget()) throw new HttpError(429, 'You have used today’s AI voice allowance. Your browser’s Tamil voice still works.');
      const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
      try { hit = await tts.synth(text, 'ta', ac.signal); cached = false; } catch (e: any) { if (e instanceof TtsError) throw new HttpError(e.status === 499 ? 499 : e.status === 504 ? 504 : 502, e.message); throw e; }
      lru.set(k, hit); await q.run(db, 'INSERT INTO ai_usage(user_id,provider,kind,input_chars,output_chars,at) VALUES (?,?,?,?,?,?)', req.user!.id, tts.name, 'tts', text.length, hit.audio.length, iso());
    }
    res.setHeader('Content-Type', hit.mime); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Audio-Cache', cached ? 'server-hit' : 'miss'); res.send(hit.audio);
  }));
  return r;
}
