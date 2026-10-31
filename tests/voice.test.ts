import { q as dq } from '../server/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });
const login = async (email: string) => { const c = client(ctx.app); expect((await c.login(email)).status).toBe(200); const csrf = (await c.get('/api/auth/me')).body.csrf; return { c, csrf }; };
const mk = async (s: any, body: any = {}) => (await s.c.post('/api/voice/sessions', body)).body.session;
const turn = async (s: any, id: string, body: any) => s.c.post(`/api/voice/sessions/${id}/turn`, body);
const chunks = (r: any) => r.body.events.filter((e: any) => e.type === 'chunk');
const all = (r: any) => chunks(r).map((c: any) => `${c.en}\n${c.ta}`).join('\n');

describe('voice tutor', () => {
  it('teaches an equation one step at a time (English) and checks understanding', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'teach', lang: 'en' });
    const r1 = await turn(s, ses.id, { text: 'Solve 3x + 5 = 20' }); expect(r1.status).toBe(200);
    const steps = chunks(r1).filter((c: any) => c.kind === 'step'); expect(steps).toHaveLength(1); expect(steps[0].en).toMatch(/^Step 1 of/); expect(chunks(r1).some((c: any) => c.kind === 'check')).toBe(true);
    expect(chunks(r1)[0].grounded).toBe('solver'); expect(chunks(r1)[0].sources[0]).toMatch(/not from a textbook/);
    const r2 = await turn(s, ses.id, { text: 'yes' }); expect(chunks(r2).find((c: any) => c.kind === 'step').en).toMatch(/^Step 2 of/);
  });
  it('works in Tamil and bilingual: both languages are present and the equation is spoken, not read symbol by symbol', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'explain', lang: 'ta' });
    const r = await turn(s, ses.id, { text: '3x + 5 = 20 ஐத் தீர்க்க' }); const st = chunks(r).filter((c: any) => c.kind === 'step'); expect(st.length).toBeGreaterThan(2);
    expect(st[0].ta).toMatch(/[஀-௿]/); expect(st[0].say.ta).toMatch(/சமம்/); expect(st[0].say.en).toMatch(/equals/); expect(st[0].say.en).not.toMatch(/=/); expect(st[0].math.length).toBeGreaterThan(0);
    expect(chunks(r).at(-1).kind).toBe('summary');
  });
  it('wrong answer → hint first, then the answer; right answer → praise and next step', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'teach', lang: 'en' });
    await turn(s, ses.id, { text: 'solve x + 1 = 3' }); // short plan
    let r = await turn(s, ses.id, { text: 'yes' }); let guard = 0;
    while (!chunks(r).some((c: any) => c.kind === 'check' && /Your turn/.test(c.en)) && guard++ < 6) r = await turn(s, ses.id, { text: 'yes' });
    expect(chunks(r).some((c: any) => /Your turn/.test(c.en))).toBe(true);
    const w1 = await turn(s, ses.id, { text: '99' }); expect(all(w1)).toMatch(/Not quite/); expect(chunks(w1).some((c: any) => c.kind === 'hint')).toBe(true); expect(all(w1)).not.toMatch(/answer is x = 2/);
    const w2 = await turn(s, ses.id, { text: '98' }); expect(all(w2)).toMatch(/answer is x = 2/);
  });
  it('correct final answer is praised and finishes with a summary', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'teach', lang: 'en' }); await turn(s, ses.id, { text: 'solve x + 1 = 3' });
    let r: any; for (let i = 0; i < 6; i++) { r = await turn(s, ses.id, { text: 'yes' }); if (chunks(r).some((c: any) => /Your turn/.test(c.en))) break; }
    const ok = await turn(s, ses.id, { text: 'x is 2' }); expect(all(ok)).toMatch(/Correct|right|Exactly/); expect(chunks(ok).at(-1).kind).toBe('summary'); expect(ok.body.meta.completed).toBe(true);
    expect((await s.c.get('/api/voice/progress')).body.completed.length).toBe(1);
  });
  it('“no” gets a simpler explanation of the same step; the simpler action works too', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'teach', lang: 'en' }); await turn(s, ses.id, { text: 'Solve 3x + 5 = 20' });
    const n = await turn(s, ses.id, { text: 'no, I do not understand' }); expect(all(n)).toMatch(/In simpler words/);
    const sm = await turn(s, ses.id, { action: 'simpler' }); expect(all(sm)).toMatch(/balance/); const rp = await turn(s, ses.id, { action: 'repeat' }); expect(all(rp)).toMatch(/Step 1 of/);
  });
  it('hint mode gives progressive hints, never the answer straight away', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'hint', lang: 'en' });
    const h0 = await turn(s, ses.id, { text: '' , action: 'hint' }); expect(all(h0)).toMatch(/Tell me the question/);
    const h1 = await turn(s, ses.id, { text: 'Solve 3x + 5 = 20' }); expect(all(h1)).toMatch(/Hint 1/); expect(all(h1)).not.toMatch(/x = 5/);
    const h2 = await turn(s, ses.id, { action: 'hint' }); expect(all(h2)).toMatch(/Hint 2/); expect(all(h2)).not.toMatch(/x = 5\b.*answer/i);
    let last = h2; for (let i = 0; i < 6 && !/answer is/i.test(all(last)); i++) last = await turn(s, ses.id, { action: 'hint' });
    expect(all(last)).toMatch(/answer is x = 5/);
  });
  it('practice mode asks a question, evaluates the answer and tracks mistakes', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'practice', lang: 'en', subjectId: 'maths' });
    const q1 = await turn(s, ses.id, { text: 'start' }); expect(chunks(q1).some((c: any) => c.kind === 'question')).toBe(true);
    const bad = await turn(s, ses.id, { text: 'zzz' }); expect(all(bad)).toMatch(/Not quite|hint/i);
    const give = await turn(s, ses.id, { text: 'show the answer' }); expect(all(give)).toMatch(/answer is|விடை/i);
    expect((await s.c.get('/api/voice/progress')).body.quiz.total).toBeGreaterThanOrEqual(1);
  });
  it('revise mode summarises the lesson and starts a short quiz', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'revise', lang: 'en', lessonId: 'c8-maths-linear' });
    const rv = await turn(s, ses.id, { text: 'revise this topic' }); expect(chunks(rv).some((c: any) => c.kind === 'summary')).toBe(true); expect(chunks(rv).some((c: any) => c.kind === 'question')).toBe(true);
  });
  it('is honest when there is no verified source — and does not cite one', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'teach', lang: 'en' });
    const r = await turn(s, ses.id, { text: 'Explain the zorblax gravitational dynamics of quantum marmalade' }); expect(chunks(r)[0].kind).toBe('notice'); expect(chunks(r)[0].en).toMatch(/will not guess/); expect(chunks(r)[0].sources ?? []).toHaveLength(0); expect(r.body.meta.grounded).toBe('none');
  });
  it('teaches from the class lesson, and from a class textbook page only for the student’s class', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'explain', lang: 'both', lessonId: 'c8-maths-linear' });
    const r = await turn(s, ses.id, { text: 'What is an equation?' }); expect(r.body.meta.grounded).toBe('lesson'); expect(chunks(r).find((c: any) => c.kind === 'step').sources[0]).toMatch(/Class 8/);
    const bad = await s.c.post('/api/voice/sessions', { lessonId: 'c10-nope' }); expect(bad.status).toBe(404);
  });
  it('switching voice → typing is the same API; the transcript is saved and a refresh resumes the session', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'teach', lang: 'en' });
    await turn(s, ses.id, { text: 'Solve 3x + 5 = 20', via: 'voice' }); await turn(s, ses.id, { text: 'yes', via: 'text' });
    const back = (await s.c.get(`/api/voice/sessions/${ses.id}`)).body; expect(back.session.state.idx).toBe(1); expect(back.turns.map((t: any) => t.kind)).toContain('voice'); expect(back.turns.map((t: any) => t.kind)).toContain('text');
    const nxt = await turn(s, ses.id, { action: 'repeat' }); expect(all(nxt)).toMatch(/Step 2 of/); // continues where it left off
    expect((await s.c.get('/api/voice/sessions')).body.sessions[0].id).toBe(ses.id);
  });
  it('saveTranscript=false keeps no transcript; deleting a session removes everything', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { saveTranscript: false }); await turn(s, ses.id, { text: 'Solve 3x + 5 = 20' });
    expect((await s.c.get(`/api/voice/sessions/${ses.id}`)).body.turns).toHaveLength(0);
    const ses2 = await mk(s, {}); await turn(s, ses2.id, { text: 'Solve 3x + 5 = 20' }); expect((await s.c.agent.delete(`/api/voice/sessions/${ses2.id}`).set('x-csrf-token', s.csrf)).status).toBe(200); expect((await s.c.get(`/api/voice/sessions/${ses2.id}`)).status).toBe(404);
  });
  it('streams events as server-sent events and stops cleanly when the client disconnects', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, { mode: 'explain', lang: 'en' });
    const r = await s.c.agent.post(`/api/voice/sessions/${ses.id}/turn`).set('x-csrf-token', s.csrf).set('Accept', 'text/event-stream').send({ text: 'Solve 3x + 5 = 20' }).buffer(true).parse((res: any, cb: any) => { let d = ''; res.on('data', (c: Buffer) => (d += c)); res.on('end', () => cb(null, d)); });
    expect(r.headers['content-type']).toMatch(/text\/event-stream/); const evs = String(r.body).split('\n\n').filter(Boolean).map(b => b.split('\n')[0].replace('event: ', '')); expect(evs[0]).toBe('ack'); expect(evs.at(-1)).toBe('done'); expect(evs.filter(e => e === 'chunk').length).toBeGreaterThan(3);
  });
  it('blocks duplicate in-flight turns, enforces the daily limit, and isolates students', async () => {
    const a = await login(DEMO.student); const ses = await mk(a, {});
    const o = await login(DEMO.arun); expect((await o.c.get(`/api/voice/sessions/${ses.id}`)).status).toBe(404); expect((await turn(o, ses.id, { text: 'hi' })).status).toBe(404);
    await dq.run(ctx.db, "INSERT INTO settings(key,value) VALUES ('voice_daily_limit','0') ON CONFLICT(key) DO UPDATE SET value=excluded.value"); expect((await turn(a, ses.id, { text: 'Solve 5x = 10' })).status).toBe(429);
    const p = await login(DEMO.parent); expect((await p.c.post('/api/voice/sessions', {})).status).toBe(403);
  });
  it('a slow engine: duplicate turn → 409, busy queue → 503, and a disconnect mid-answer does not advance the lesson', async () => {
    const slow = { name: 'slow', mock: true, async *turn(c: any) { yield { type: 'ack' }; await new Promise(r => setTimeout(r, 150)); yield { type: 'chunk', kind: 'info', en: 'a', ta: 'அ', say: { en: 'a', ta: 'அ' } }; await new Promise(r => setTimeout(r, 150)); c.state.idx++; yield { type: 'done', state: c.state, meta: { grounded: 'none' } }; } };
    ctx = await setup({ voiceEngine: slow, voiceMax: 1, voiceQueueMs: 20 });
    const a = await login(DEMO.student), b = await login(DEMO.arun); const sa = await mk(a, {}), sb = await mk(b, {});
    const [x, y, z] = await Promise.all([turn(a, sa.id, { text: 'one' }), turn(a, sa.id, { text: 'two' }), new Promise<any>(r => setTimeout(async () => r(await turn(b, sb.id, { text: 'three' })), 40))]);
    expect([x.status, y.status].sort()).toEqual([200, 409]); expect(z.status).toBe(503); expect(z.body.error).toMatch(/busy/);
    // client disconnects after the first event: state must not advance
    const srv = ctx.app.listen(0); const base = `http://127.0.0.1:${(srv.address() as any).port}`; try {
      const lr = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: DEMO.student, password: (await import('../server/seed')).DEMO_PASSWORD }) }); const cookie = lr.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); const csrf = ((await lr.json()) as any).csrf;
      const before = (await (await fetch(`${base}/api/voice/sessions/${sa.id}`, { headers: { cookie } })).json() as any).session.state.idx;
      const ac = new AbortController(); const res = await fetch(`${base}/api/voice/sessions/${sa.id}/turn`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ text: 'four' }), signal: ac.signal });
      const rd = res.body!.getReader(); await rd.read(); ac.abort(); await new Promise(r => setTimeout(r, 400));
      expect((await (await fetch(`${base}/api/voice/sessions/${sa.id}`, { headers: { cookie } })).json() as any).session.state.idx).toBe(before);
    } finally { srv.close(); }
  });
  it('many students at once all get answers; the queue limit protects the model', async () => {
    const students = await Promise.all([DEMO.student, DEMO.arun].map(login)); const sess = await Promise.all(students.map(s => mk(s, { lang: 'en' })));
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => turn(students[i % 2], sess[i % 2].id, { text: `Solve ${i + 2}x + 1 = ${(i + 2) * 3 + 1}` }))); const ok = rs.filter(r => r.status === 200).length, busy = rs.filter(r => r.status === 409).length;
    expect(ok + busy).toBe(12); expect(ok).toBeGreaterThanOrEqual(2);
    const { Gate } = await import('../server/routes/voice'); const g = new Gate(1, 30); const rel = await g.acquire(); await expect(g.acquire()).rejects.toThrow(/busy/); rel();
  });
  it('records latency metrics without storing what was said; realtime provider is honestly unavailable', async () => {
    const s = await login(DEMO.student); const ses = await mk(s, {}); await turn(s, ses.id, { text: 'Solve 3x + 5 = 20' });
    expect((await s.c.post(`/api/voice/sessions/${ses.id}/metrics`, { kind: 'first_audio', ms: 420 })).status).toBe(200); expect((await s.c.post(`/api/voice/sessions/${ses.id}/metrics`, { kind: 'bogus', ms: 1 })).status).toBe(400);
    const ad = await login(DEMO.admin); const m = (await ad.c.get('/api/voice/metrics')).body; expect(m.latencyMs.server_first_event.n).toBeGreaterThan(0); expect(m.latencyMs.first_audio.p50).toBe(420); expect(JSON.stringify(m)).not.toMatch(/3x/);
    expect((await s.c.post('/api/voice/realtime-token', {})).status).toBe(501); expect((await s.c.get('/api/voice/metrics')).status).toBe(403);
  });
});
