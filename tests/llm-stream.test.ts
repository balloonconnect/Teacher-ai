import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { client, DEMO, setup } from './helpers';
import { anthropicClient, openaiClient, llmEngine, sseData, jsonLines } from '../server/services/llmEngine';
import { initialState } from '../server/services/teach';

/** A mock provider that streams server-sent events on a schedule: each piece is sent after its delay (ms). */
type Piece = { after: number; text: string } | { after: number; kill: true };
let script: Piece[] = []; let format: 'anthropic' | 'openai' = 'anthropic'; let nReq = 0; let status = 200;
const server = http.createServer((req, res) => {
  const c: Buffer[] = []; req.on('data', d => c.push(d)); req.on('end', async () => {
    nReq++; const body = JSON.parse(Buffer.concat(c).toString() || '{}');
    if (status !== 200) { res.writeHead(status, { 'content-type': 'application/json' }); res.end('{}'); return; }
    if (!body.stream) { res.writeHead(500); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const p of script) {
      await new Promise(r => setTimeout(r, p.after));
      if ('kill' in p) { res.destroy(); return; }
      res.write(format === 'anthropic' ? `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p.text } })}\n\n` : `data: ${JSON.stringify({ choices: [{ delta: { content: p.text } }] })}\n\n`);
    }
    res.write(format === 'anthropic' ? `event: message_stop\ndata: {"type":"message_stop"}\n\n` : 'data: [DONE]\n\n'); res.end();
  });
});
let base = ''; beforeAll(async () => { await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r())); base = `http://127.0.0.1:${(server.address() as any).port}`; }); afterAll(() => { server.close(); });
beforeEach(() => { nReq = 0; status = 200; format = 'anthropic'; });

const line = (o: any) => JSON.stringify(o) + '\n';
const S1 = { en: 'An equation says two things are equal, like 3 + 2 = 5.', ta: 'சமன்பாடு இரண்டு மதிப்புகள் சமம் என்று கூறுகிறது.', cite: [1], check: { kind: 'cloze', blank: 'An equation says two things are ____.', answer: 'equal' } };
const S2 = { en: 'Whatever we do to one side we do to the other.', ta: 'ஒரு பக்கம் செய்வதை மறு பக்கமும் செய்க.', cite: [1], check: { kind: 'ack' } };
const S3 = { en: 'Check the answer by putting it back in the equation.', ta: 'விடையைச் சமன்பாட்டில் இட்டுச் சரிபார்க்க.', cite: [1] };
const HEAD = { topic: { en: 'Equations', ta: 'சமன்பாடுகள்' } };

let t: Awaited<ReturnType<typeof setup>>; const fallbacks: string[] = [];
const boot = async (kind: 'anthropic' | 'openai' = 'anthropic', timeoutMs?: number) => {
  const cl = kind === 'anthropic' ? anthropicClient({ apiKey: 'k', model: 'm', baseUrl: base }) : openaiClient({ apiKey: 'k', model: 'm', baseUrl: base });
  t = await setup({ voiceEngine: llmEngine(cl, { timeoutMs, onFallback: w => fallbacks.push(w) }) }); fallbacks.length = 0; return cl;
};
/** Runs one turn directly against the engine and records when each event arrived. */
async function run(cl: any, text: string, mode: any = 'teach', state = initialState(mode)) {
  const eng = llmEngine(cl, { onFallback: w => fallbacks.push(w) }); const t0 = Date.now(); const evs: { ev: any; at: number }[] = [];
  const ctx: any = { db: t.db, userId: 'u', classLevel: 8, lang: 'en', subjectId: null, lessonId: 'c8-maths-linear', state };
  for await (const ev of eng.turn(ctx, { text })) evs.push({ ev, at: Date.now() - t0 });
  return { evs, state, steps: evs.filter(e => e.ev.kind === 'step'), done: evs.find(e => e.ev.type === 'done')! };
}

describe('streamed lesson', () => {
  it('speaks step 1 while the model is still writing the rest, then saves the complete plan', async () => {
    const cl = await boot();
    script = [{ after: 0, text: line(HEAD) }, { after: 0, text: line(S1) }, { after: 500, text: line(S2) }, { after: 0, text: line(S3) }];
    const r = await run(cl, 'what is an equation');
    expect(nReq).toBe(1); expect(fallbacks).toEqual([]);
    expect(r.steps).toHaveLength(1); expect(r.steps[0].ev.en).toMatch(/^Step 1: An equation says/); expect(r.steps[0].ev.total).toBeUndefined(); // the total is not known yet
    expect(r.steps[0].at).toBeLessThan(400); // first step arrives long before the model has finished…
    expect(r.done.at).toBeGreaterThanOrEqual(480); // …the turn only ends once the plan is complete
    expect(r.state.plan!.steps).toHaveLength(3); expect(r.state.awaiting).toBe('check'); expect(r.state.plan!.grounded).toBe('lesson'); expect(r.state.plan!.topic.en).toBe('Equations');
    expect(r.evs.find(e => e.ev.kind === 'check')!.ev.en).toMatch(/fill in the blank/);
  });
  it('carries on to steps 2 and 3 on later turns, now showing "of 3"', async () => {
    const cl = await boot(); script = [{ after: 0, text: line(HEAD) + line(S1) + line(S2) + line(S3) }];
    const r = await run(cl, 'what is an equation'); const eng = llmEngine(cl);
    const next = async (txt: string) => { const ctx: any = { db: t.db, userId: 'u', classLevel: 8, lang: 'en', subjectId: null, lessonId: 'c8-maths-linear', state: r.state }; const out: any[] = []; for await (const ev of eng.turn(ctx, { text: txt })) out.push(ev); return out; };
    const a = await next('equal'); expect(a.find(e => e.kind === 'step').en).toMatch(/^Step 2 of 3:/);
    const b = await next('yes'); expect(b.find(e => e.kind === 'step').en).toMatch(/^Step 3 of 3:/);
    expect(nReq).toBe(1); // only one model call for the whole lesson
  });
  it('drops uncited or invalid lines mid-stream and tolerates fences and chatter', async () => {
    const cl = await boot();
    script = [{ after: 0, text: '```json\n' + line(HEAD) + 'Sure, here you go:\n' + line({ en: 'Made up fact.', ta: 'கற்பனை.', cite: [] }) + line(S1) + line({ ...S2, cite: [42] }) + line(S3) + '```\n' }];
    const r = await run(cl, 'what is an equation'); expect(fallbacks).toEqual([]);
    expect(JSON.stringify(r.evs)).not.toMatch(/Made up fact/); expect(r.state.plan!.steps.map(s => s.en)).toEqual([S1.en, S3.en]);
  });
  it('works when a line is split across network pieces', async () => {
    const cl = await boot(); const all = line(HEAD) + line(S1) + line(S2);
    script = [...all.match(/[\s\S]{1,37}/g)!.map(text => ({ after: 1, text }))];
    const r = await run(cl, 'what is an equation'); expect(r.state.plan!.steps).toHaveLength(2);
  });
  it('works with an OpenAI-compatible stream', async () => {
    const cl = await boot('openai'); format = 'openai'; script = [{ after: 0, text: line(HEAD) + line(S1) }, { after: 50, text: line(S2) }];
    const r = await run(cl, 'what is an equation'); expect(r.state.plan!.steps).toHaveLength(2); expect(r.steps[0].ev.en).toMatch(/^Step 1:/);
  });
  it('explain mode streams every step as it arrives', async () => {
    const cl = await boot(); script = [{ after: 0, text: line(HEAD) + line(S1) }, { after: 150, text: line(S2) }];
    const r = await run(cl, 'what is an equation', 'explain'); expect(r.steps).toHaveLength(2); expect(r.steps[1].at - r.steps[0].at).toBeGreaterThanOrEqual(120);
    expect(r.state.done).toBe(true); expect(r.evs.some(e => e.ev.kind === 'summary')).toBe(true);
  });
  it('keeps what was already taught if the connection drops after step 1', async () => {
    const cl = await boot(); script = [{ after: 0, text: line(HEAD) + line(S1) }, { after: 50, kill: true }];
    const r = await run(cl, 'what is an equation'); expect(r.state.plan!.steps).toHaveLength(1); expect(r.done.ev.type).toBe('done'); expect(r.steps).toHaveLength(1);
    expect(nReq).toBe(1); // no second model call
  });
  it('uses the built-in lesson, with one model call, if the stream fails before any step', async () => {
    const cl = await boot(); script = [{ after: 0, text: line(HEAD) }, { after: 20, kill: true }];
    const r = await run(cl, 'what is an equation'); expect(nReq).toBe(1); expect(fallbacks).toHaveLength(1); expect(r.steps.length).toBe(1); expect(r.steps[0].ev.en).toMatch(/^Step 1 of \d+:/); // built-in plan knows its length
  });
  it('uses the built-in lesson if the provider errors (503)', async () => {
    const cl = await boot(); status = 503; const r = await run(cl, 'what is an equation'); expect(fallbacks).toHaveLength(1); expect(r.steps.length).toBe(1);
  });
  it('times out a stalled stream', async () => {
    const cl = await boot(); script = [{ after: 0, text: line(HEAD) }, { after: 2000, text: line(S1) }];
    const eng = llmEngine(cl, { timeoutMs: 150, onFallback: w => fallbacks.push(w) }); const ctx: any = { db: t.db, userId: 'u', classLevel: 8, lang: 'en', subjectId: null, lessonId: 'c8-maths-linear', state: initialState('teach') };
    const out: any[] = []; for await (const ev of eng.turn(ctx, { text: 'what is an equation' })) out.push(ev);
    expect(fallbacks).toEqual(['timeout']); expect(out.some(e => e.kind === 'step')).toBe(true);
  });
  it('still never streams equations or unsourced questions', async () => {
    const cl = await boot(); script = [{ after: 0, text: line(HEAD) + line(S1) }];
    await run(cl, 'Solve 3x + 5 = 20'); await run(cl, 'Tell me about quasars and neutron stars', 'teach', { ...initialState('teach') });
    expect(nReq).toBe(0);
  });
  it('through the API: the saved session continues from the streamed plan', async () => {
    await boot(); script = [{ after: 0, text: line(HEAD) + line(S1) }, { after: 30, text: line(S2) }];
    const c = client(t.app); await c.login(DEMO.student); const ses = (await c.post('/api/voice/sessions', { lang: 'en', mode: 'teach', lessonId: 'c8-maths-linear' })).body.session;
    const a = await c.post(`/api/voice/sessions/${ses.id}/turn`, { text: 'what is an equation' }); expect(a.status).toBe(200);
    const b = await c.post(`/api/voice/sessions/${ses.id}/turn`, { text: 'equal' }); expect(b.body.events.find((e: any) => e.kind === 'step').en).toMatch(/^Step 2 of 2:/);
  });
});

describe('stream plumbing', () => {
  const body = (s: string, size: number) => new ReadableStream<Uint8Array>({ start(c) { const b = new TextEncoder().encode(s); for (let i = 0; i < b.length; i += size) c.enqueue(b.slice(i, i + size)); c.close(); } });
  it('parses SSE data lines even when events are cut anywhere, including inside multi-byte Tamil', async () => {
    const s = 'event: x\ndata: {"a":"தமிழ்"}\n\ndata: {"b":2}\r\n\r\ndata: [DONE]\n\n';
    for (const size of [1, 2, 5, 1000]) { const out: string[] = []; for await (const d of sseData(body(s, size))) out.push(d); expect(out).toEqual(['{"a":"தமிழ்"}', '{"b":2}', '[DONE]']); }
  });
  it('turns text pieces into JSON objects line by line', async () => {
    async function* g() { yield '{"a":1}\n{"b"'; yield ':2}\n\n```\n{"c":3}'; }
    const out: any[] = []; for await (const x of jsonLines(g())) out.push(x.obj); expect(out).toEqual([{ a: 1 }, { b: 2 }, null, { c: 3 }]);
  });
});
