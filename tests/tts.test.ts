import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import { client, DEMO, setup } from './helpers';
import { httpTts, AudioLru, TtsError, ttsFromEnv } from '../server/services/tts';

const WAV = Buffer.from('RIFF$\0\0\0WAVEfmt ', 'binary');
let calls: any[] = []; let mode: 'ok' | 'err' | 'text' | 'slow' = 'ok';
const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { calls.push({ auth: req.headers.authorization, body: JSON.parse(b || '{}') });
  if (mode === 'err') { res.statusCode = 500; res.end('x'); } else if (mode === 'text') { res.setHeader('content-type', 'text/html'); res.end('<html>'); } else if (mode === 'slow') { /* never answers */ } else { res.setHeader('content-type', 'audio/wav'); res.end(WAV); } }); });
await new Promise<void>(r => srv.listen(0, r)); const url = `http://127.0.0.1:${(srv.address() as any).port}/v1/audio/speech`;
afterAll(() => { srv.closeAllConnections?.(); srv.close(); });
const reset = (m: typeof mode = 'ok') => { calls = []; mode = m; };
async function login(ctx: any, who = DEMO.student) { const c = client(ctx.app); await c.login(who); await c.get('/api/auth/me'); const s = await c.post('/api/voice/sessions', { mode: 'teach', lang: 'en', saveTranscript: false }); return { c, id: s.body.session.id as string }; }

describe('http TTS provider', () => {
  it('sends the key and text server-side and returns audio', async () => {
    reset(); const p = httpTts({ url, apiKey: 'sekret', model: 'm', voiceEn: 'en1', voiceTa: 'ta1', format: 'wav' }); const r = await p.synth('Hello', 'ta', new AbortController().signal);
    expect(r.mime).toBe('audio/wav'); expect(r.audio.length).toBe(WAV.length); expect(calls[0].auth).toBe('Bearer sekret'); expect(calls[0].body).toMatchObject({ input: 'Hello', voice: 'ta1', model: 'm' });
  });
  it('maps errors, non-audio replies and timeouts to clear TtsErrors', async () => {
    reset('err'); await expect(httpTts({ url }).synth('a', 'en', new AbortController().signal)).rejects.toThrow(/error \(500\)/);
    reset('text'); await expect(httpTts({ url }).synth('a', 'en', new AbortController().signal)).rejects.toThrow(/did not return audio/);
    reset('slow'); const t0 = Date.now(); await expect(httpTts({ url, timeoutMs: 150 }).synth('a', 'en', new AbortController().signal)).rejects.toMatchObject({ status: 504 }); expect(Date.now() - t0).toBeLessThan(1500);
    await expect(httpTts({ url: 'http://127.0.0.1:1/x' }).synth('a', 'en', new AbortController().signal)).rejects.toBeInstanceOf(TtsError);
  });
  it('ttsFromEnv is off without TTS_URL', () => { expect(ttsFromEnv({} as any)).toBeNull(); expect(ttsFromEnv({ TTS_URL: url } as any)?.name).toMatch(/^tts:/); });
  it('LRU evicts the oldest and respects byte limits', () => { const l = new AudioLru(10, 3); for (const k of 'abcd') l.set(k, { audio: Buffer.alloc(2), mime: 'x' }); expect(l.get('a')).toBeUndefined(); expect(l.get('d')).toBeDefined(); l.set('big', { audio: Buffer.alloc(11), mime: 'x' }); expect(l.get('big')).toBeUndefined(); });
});
describe('POST /voice/tts', () => {
  it('501 when no provider is configured; config says so', async () => {
    const ctx: any = await setup({ voiceTts: null }); const { c, id } = await login(ctx); expect((await c.get('/api/voice/config')).body.tts.enabled).toBe(false);
    const r = await c.post('/api/voice/tts', { sessionId: id, text: 'Hi', lang: 'en' }); expect(r.status).toBe(501); expect(r.body.error).toMatch(/browser/i);
  });
  it('generates once, then serves the same sentence from the server cache; config never leaks the key', async () => {
    reset(); const ctx: any = await setup({ voiceTts: httpTts({ url, apiKey: 'sekret-key', format: 'wav' }) }); const { c, id } = await login(ctx);
    const cfg = await c.get('/api/voice/config'); expect(cfg.body.tts.enabled).toBe(true); expect(JSON.stringify(cfg.body)).not.toMatch(/sekret|127\.0\.0\.1/); expect(cfg.body.notes).toMatch(/reply text/);
    const bin = (r: any) => r.buffer(true).parse((res: any, cb: any) => { const d: Buffer[] = []; res.on('data', (x: Buffer) => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); });
    const a = await bin(c.post('/api/voice/tts', { sessionId: id, text: 'Step 1. Start with the equation.', lang: 'en' })); expect(a.status).toBe(200); expect(a.headers['content-type']).toMatch(/audio\/wav/); expect(a.headers['x-audio-cache']).toBe('miss'); expect(a.headers['cache-control']).toMatch(/no-store/);
    const b = await bin(c.post('/api/voice/tts', { sessionId: id, text: 'Step 1. Start with the equation.', lang: 'en' })); expect(b.headers['x-audio-cache']).toBe('server-hit'); expect(calls.length).toBe(1); expect(Buffer.compare(a.body, b.body)).toBe(0);
  });
  it('validates input, ownership and the daily allowance; failures are clean 5xx messages', async () => {
    reset(); const ctx: any = await setup({ voiceTts: httpTts({ url, format: 'wav' }) }); const { c, id } = await login(ctx);
    expect((await c.post('/api/voice/tts', { sessionId: id, text: 'x'.repeat(501), lang: 'en' })).status).toBe(400); expect((await c.post('/api/voice/tts', { sessionId: id, text: 'Hi', lang: 'fr' })).status).toBe(400);
    expect((await c.post('/api/voice/tts', { sessionId: 'nope', text: 'Hi', lang: 'en' })).status).toBe(404);
    const other = client(ctx.app); await other.login(DEMO.parent); expect((await other.post('/api/voice/tts', { sessionId: id, text: 'Hi', lang: 'en' })).status).toBeGreaterThanOrEqual(400);
    reset('err'); const e = await c.post('/api/voice/tts', { sessionId: id, text: 'Something new', lang: 'en' }); expect(e.status).toBe(502); expect(e.body.error).toMatch(/voice service/);
    process.env.VOICE_TTS_DAILY_CHARS = '20'; try { await c.post('/api/voice/tts', { sessionId: id, text: 'Twelve chars', lang: 'en' }); const over = await c.post('/api/voice/tts', { sessionId: id, text: 'Another sentence here', lang: 'en' }); expect(over.status).toBe(429); expect(over.body.error).toMatch(/text lesson/); } finally { delete process.env.VOICE_TTS_DAILY_CHARS; }
  });
  it('a failing voice service never blocks the text lesson', async () => {
    reset('err'); const ctx: any = await setup({ voiceTts: httpTts({ url }) }); const { c, id } = await login(ctx);
    expect((await c.post('/api/voice/tts', { sessionId: id, text: 'Hello there', lang: 'en' })).status).toBe(502);
    const t = await c.post(`/api/voice/sessions/${id}/turn`, { text: 'Solve 3x + 5 = 20' }); expect(t.status).toBe(200); expect(t.body.events.some((e: any) => e.type === 'chunk')).toBe(true);
  });
});
