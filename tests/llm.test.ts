import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { client, DEMO, setup } from './helpers';
import { anthropicClient, openaiClient, llmEngine, llmClientFromEnv, planFromModel, extractJson, type Src } from '../server/services/llmEngine';

type Req = { url: string; headers: http.IncomingHttpHeaders; body: any };
let reqs: Req[] = []; let reply: (r: Req) => { status?: number; body: any; delayMs?: number } = () => ({ body: {} });
const server = http.createServer((req, res) => {
  const c: Buffer[] = []; req.on('data', d => c.push(d)); req.on('end', () => {
    const r: Req = { url: req.url!, headers: req.headers, body: JSON.parse(Buffer.concat(c).toString() || '{}') }; reqs.push(r); const o = reply(r);
    setTimeout(() => { res.writeHead(o.status ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o.body)); }, o.delayMs ?? 0);
  });
});
let base = ''; beforeAll(async () => { await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r())); base = `http://127.0.0.1:${(server.address() as any).port}`; }); afterAll(() => { server.close(); });
const anth = (text: string) => ({ body: { content: [{ type: 'text', text }] } });
const plan = (steps: any[], topic = { en: 'Equations', ta: 'சமன்பாடுகள்' }) => JSON.stringify({ topic, steps });

let ctx: Awaited<ReturnType<typeof setup>>; const fallbacks: string[] = [];
const boot = async (o: { timeoutMs?: number } = {}) => { ctx = await setup({ voiceEngine: llmEngine(anthropicClient({ apiKey: 'sk-test-123', model: 'm1', baseUrl: base }), { ...o, onFallback: w => fallbacks.push(w) }) }); };
beforeEach(() => { reqs = []; fallbacks.length = 0; reply = () => anth('{"steps":[]}'); });
const login = async () => { const c = client(ctx.app); await c.login(DEMO.student); return c; };
const ask = async (c: any, text: string, body: any = { lang: 'en', mode: 'teach', lessonId: 'c8-maths-linear' }) => { const ses = (await c.post('/api/voice/sessions', body)).body.session; return (await c.post(`/api/voice/sessions/${ses.id}/turn`, { text })).body.events as any[]; };
const chunks = (ev: any[]) => ev.filter(e => e.type === 'chunk');

describe('LLM tutor engine', () => {
  it('teaches from model-written steps that cite the student’s own lesson; sends only the question and the sources', async () => {
    await boot();
    reply = () => anth(plan([
      { en: 'An equation says two things are equal, like 3 + 2 = 5.', ta: 'சமன்பாடு இரண்டு மதிப்புகள் சமம் என்று கூறுகிறது.', cite: [1], check: { kind: 'cloze', blank: 'An equation says two things are ____.', answer: 'equal' } },
      { en: 'Whatever we do to one side we do to the other.', ta: 'ஒரு பக்கம் செய்வதை மறு பக்கமும் செய்க.', cite: [1], check: { kind: 'ack' } },
    ]));
    const c = await login(); const ev = await ask(c, 'what is an equation');
    expect(reqs).toHaveLength(1); const r = reqs[0]; expect(r.url).toBe('/v1/messages'); expect(r.headers['x-api-key']).toBe('sk-test-123');
    const sent = JSON.stringify(r.body); const user = r.body.messages[0].content as string; expect(sent).not.toContain(DEMO.student); expect(sent).not.toMatch(/meena/i); expect(user).toContain('<question>what is an equation</question>'); expect(user).toMatch(/<source id="1"/); expect(user).toMatch(/Class 8 student/);
    const step = chunks(ev).find(e => e.kind === 'step'); expect(step.en).toMatch(/^Step 1 of 2: An equation says two things are equal/); expect(step.grounded).toBe('lesson');
    expect(chunks(ev).find(e => e.kind === 'check').en).toMatch(/fill in the blank: An equation says two things are _____?/); expect(step.sources.length).toBeGreaterThan(0);
    expect(chunks(ev).filter(e => e.kind === 'step')).toHaveLength(1); // one step at a time
  });
  it('never sends an equation to the model — the solver does the maths', async () => {
    await boot(); const c = await login(); const ev = await ask(c, 'Solve 3x + 5 = 20');
    expect(reqs).toHaveLength(0); expect(chunks(ev)[0].grounded).toBe('solver');
  });
  it('is honest when there is no source: no model call, no invented answer', async () => {
    await boot(); const c = await login(); const ev = await ask(c, 'Tell me about quasars and neutron stars', { lang: 'en', mode: 'teach' });
    expect(reqs).toHaveLength(0); expect(chunks(ev)[0].grounded).toBe('none'); expect(chunks(ev)[0].en).toMatch(/will not guess/);
  });
  it.each([
    ['a server error', () => ({ status: 500, body: { error: 'x' } })],
    ['garbage text', () => anth('Sure! Here is some chatty text but no JSON at all.')],
    ['empty steps', () => anth('{"steps":[]}')],
    ['all steps uncited', () => anth(plan([{ en: 'Made up fact.', ta: 'கற்பனை.', cite: [] }]))],
    ['citing sources that do not exist', () => anth(plan([{ en: 'Made up fact.', ta: 'கற்பனை.', cite: [99] }]))],
  ])('falls back to the rule-based lesson on %s — the lesson still works and nothing unverified is shown', async (_n, r) => {
    await boot(); reply = r as any; const c = await login(); const ev = await ask(c, 'what is an equation');
    expect(fallbacks.length).toBe(1); expect(chunks(ev).find(e => e.kind === 'step')).toBeTruthy(); expect(JSON.stringify(ev)).not.toMatch(/Made up fact/);
  });
  it('falls back when the model is too slow', async () => {
    await boot({ timeoutMs: 80 }); reply = () => ({ ...anth(plan([{ en: 'Slow.', ta: 'மெதுவாக.', cite: [1] }])), delayMs: 600 }); const c = await login(); const ev = await ask(c, 'what is an equation');
    expect(fallbacks).toEqual(['timeout']); expect(JSON.stringify(ev)).not.toMatch(/Slow\./); expect(chunks(ev).find(e => e.kind === 'step')).toBeTruthy();
  });
  it('retries once on a busy provider (429) and then succeeds', async () => {
    await boot(); let n = 0; reply = () => (++n === 1 ? { status: 429, body: {} } : anth(plan([{ en: 'Equations balance.', ta: 'சமன்பாடு சமநிலை.', cite: [1] }])));
    const c = await login(); const ev = await ask(c, 'what is an equation'); expect(reqs).toHaveLength(2); expect(fallbacks).toHaveLength(0); expect(chunks(ev).find(e => e.kind === 'step').en).toMatch(/Equations balance/);
  });
});

describe('plan validation', () => {
  const sources: Src[] = [{ id: 1, label: 'Lesson A', text: 'x', lesson: true }, { id: 2, label: 'Book, page 7', text: 'y', lesson: false, bookId: 'b1', page: 7 }];
  const c = (lang: 'en' | 'ta' | 'both') => ({ lang, classLevel: 8 }) as any;
  it('keeps only cited steps, drops cloze answers that are not in the text, and records book pages', () => {
    const p = planFromModel(plan([
      { en: 'Rivers carry water to the sea.', ta: 'ஆறுகள் கடலுக்கு நீர் கொண்டுசெல்கின்றன.', cite: [2], check: { kind: 'cloze', blank: 'Rivers carry ____ to the sea.', answer: 'water' } },
      { en: 'Uncited.', ta: 'மேற்கோள் இல்லை.', cite: [] },
      { en: 'Bad blank.', ta: 'தவறு.', cite: [1], check: { kind: 'cloze', blank: 'Bad ____.', answer: 'zebra' } },
    ]), c('both'), sources)!;
    expect(p.steps).toHaveLength(2); expect(p.steps[0].check).toEqual({ kind: 'cloze', blank: 'Rivers carry ____ to the sea.', answer: 'water' });
    expect((p.steps[1].check as any).answer).not.toBe('zebra'); expect(p.refs).toEqual([{ bookId: 'b1', page: 7 }]); expect(p.grounded).toBe('lesson'); expect(p.sources).toEqual(['Lesson A', 'Book, page 7']);
  });
  it('requires both languages in bilingual mode but fills the missing one in single-language mode', () => {
    const s = [{ en: 'Only English.', cite: [1] }];
    expect(planFromModel(plan(s), c('both'), sources)).toBeNull();
    expect(planFromModel(plan(s), c('en'), sources)!.steps[0].ta).toBe('Only English.');
    expect(planFromModel(plan([{ ta: 'தமிழ் மட்டும்.', cite: [1] }]), c('ta'), sources)!.steps[0].en).toBe('தமிழ் மட்டும்.');
  });
  it('extracts JSON from fenced or chatty replies and rejects the rest', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 }); expect(extractJson('no json')).toBeNull(); expect(extractJson('{broken')).toBeNull();
  });
});

describe('providers', () => {
  it('OpenAI-compatible client speaks chat/completions with a bearer key', async () => {
    reqs = []; reply = () => ({ body: { choices: [{ message: { content: 'hello' } }] } });
    const out = await openaiClient({ apiKey: 'k1', model: 'local-model', baseUrl: base + '/v1' }).complete({ system: 's', user: 'u', maxTokens: 10, signal: new AbortController().signal });
    expect(out).toBe('hello'); expect(reqs[0].url).toBe('/v1/chat/completions'); expect(reqs[0].headers.authorization).toBe('Bearer k1'); expect(reqs[0].body.messages.map((m: any) => m.role)).toEqual(['system', 'user']);
  });
  it('is selected from the environment, and absent when nothing is configured', () => {
    expect(llmClientFromEnv({} as any)).toBeNull(); expect(llmClientFromEnv({ ANTHROPIC_API_KEY: 'k' } as any)!.name).toMatch(/^anthropic:/);
    expect(llmClientFromEnv({ LLM_PROVIDER: 'openai', LLM_BASE_URL: 'http://x/v1', LLM_MODEL: 'm' } as any)!.name).toBe('openai-compatible:m');
  });
});
