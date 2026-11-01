import { describe, it, expect } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { detectKey, visualsFor, renderSvg, reflectionPoints, REFLECT_DEG, VISUAL_IDS, makeVisual, normalizeKey } from '../shared/visuals';
import { safeImageUrl } from '../server/services/visuals';

const base = { student: '', chunkText: '', kind: 'info', first: true, solver: false, mode: 'teach' };
describe('detection', () => {
  it('heart, reflection, geometry, graph (English and Tamil)', () => {
    expect(detectKey('Explain the human heart')?.id).toBe('heart');
    expect(detectKey('இதயம் எப்படி வேலை செய்கிறது')?.id).toBe('heart');
    expect(detectKey('What is reflection of light?')?.id).toBe('reflection');
    expect(detectKey('State the Pythagoras theorem')?.id).toBe('pythagoras');
    expect(detectKey('Draw the graph of y = 2x + 1')).toEqual({ id: 'graph', p: '2|1' });
  });
  it('conversational text gets no image', () => {
    for (const t of ['hello', 'thank you', 'ok', 'What is an equation?', '']) expect(detectKey(t)).toBeNull();
    expect(visualsFor({ ...base, student: 'thanks!' })).toEqual([]);
  });
  it('mentioning a label highlights it', () => { expect(detectKey('Where does the aorta go in the heart')?.hl).toBe('aorta'); });
  it('image changes with each equation step', () => {
    const a = visualsFor({ ...base, kind: 'step', first: false, solver: true, math: ['3x + 5 = 20'], step: 1, total: 4 });
    const b = visualsFor({ ...base, kind: 'step', first: false, solver: true, math: ['3x = 15'], step: 2, total: 4 });
    expect(a[0].key.p).toBe('3x + 5|20'); expect(b[0].key.p).toBe('3x|15'); expect(renderSvg(a[0].key)).not.toBe(renderSvg(b[0].key));
  });
});
describe('diagrams', () => {
  it('every diagram renders valid, script-free SVG with alt text', () => {
    for (const id of VISUAL_IDS) for (const lng of ['en', 'ta', 'both'] as const) { const svg = renderSvg({ id, p: id === 'balance' ? '3x|15' : id === 'graph' ? '2|1' : undefined }, lng)!; expect(svg.startsWith('<svg')).toBe(true); expect(svg.endsWith('</svg>')).toBe(true); expect(svg).not.toMatch(/<script|onload|onerror|href=/i); expect(svg).toContain('aria-label'); expect((svg.match(/<g[ >]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length); }
  });
  it('heart labels in the picture match the label catalogue (English and Tamil)', () => {
    const v = makeVisual({ id: 'heart' }); const en = renderSvg({ id: 'heart' }, 'en')!, ta = renderSvg({ id: 'heart' }, 'ta')!;
    for (const l of v.labels) { expect(en).toContain(l.name.en); expect(ta).toContain(l.name.ta); }
    expect(renderSvg({ id: 'heart', lvl: 'simple' }, 'en')).not.toContain('Pulmonary artery');
  });
  it('reflection ray diagram obeys the law: angle i equals angle r', () => {
    const { O, inc, ref } = reflectionPoints(); const ang = (p: { x: number; y: number }) => Math.atan2(Math.abs(p.x - O.x), O.y - p.y) * 180 / Math.PI;
    expect(ang(inc)).toBeCloseTo(REFLECT_DEG, 5); expect(ang(ref)).toBeCloseTo(ang(inc), 5); expect(inc.x).toBeLessThan(O.x); expect(ref.x).toBeGreaterThan(O.x);
  });
  it('rejects unknown ids, labels and unsafe parameters', () => {
    expect(normalizeKey({ id: 'evil' })).toBeNull(); expect(normalizeKey({ id: 'heart', hl: 'nope' })).toBeNull(); expect(normalizeKey({ id: 'balance', p: '<script>alert(1)</script>' })).toBeNull();
    expect(renderSvg({ id: 'balance', p: '<b>|1' } as any)).toBeNull();
  });
  it('visuals are labelled as original and not teacher-reviewed', () => { const v = makeVisual({ id: 'heart' }); expect(v.kind).toBe('original-svg'); expect(v.reviewed).toBe(false); expect(v.license).toMatch(/no third-party/i); });
});
describe('safeImageUrl (SSRF)', () => {
  const ok = ['example-edu.org'];
  it('accepts only https on an approved host', () => { expect(safeImageUrl('https://cdn.example-edu.org/a.png', ok).hostname).toBe('cdn.example-edu.org'); });
  it('rejects http, credentials, ports, private/loopback/IP hosts, unlisted hosts', () => {
    for (const u of ['http://example-edu.org/a.png', 'https://user:pw@example-edu.org/a.png', 'https://example-edu.org:8443/a.png', 'https://127.0.0.1/a.png', 'https://169.254.169.254/latest', 'https://[::1]/a.png', 'https://localhost/a.png', 'https://evil.com/a.png', 'https://example-edu.org.evil.com/a.png', 'file:///etc/passwd', 'javascript:alert(1)']) expect(() => safeImageUrl(u, ok), u).toThrow();
    expect(() => safeImageUrl('https://example-edu.org/a.png', [])).toThrow();
  });
});
describe('visual routes and voice turns', () => {
  it('serves cached SVG, 404s bad input', async () => {
    const ctx = await setup(); const c = client(ctx.app); const r = await c.get('/api/visuals/svg/heart?lang=en').buffer(true).parse((res: any, cb: any) => { let d = ''; res.on('data', (x: any) => (d += x)); res.on('end', () => cb(null, d)); });
    expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/image\/svg\+xml/); expect(r.headers['cache-control']).toMatch(/max-age/); expect(String(r.body)).toContain('Right atrium');
    const r2 = await c.get('/api/visuals/svg/heart?lang=en').set('If-None-Match', r.headers.etag); expect(r2.status).toBe(304);
    expect((await c.get('/api/visuals/svg/nope')).status).toBe(404); expect((await c.get('/api/visuals/svg/heart?hl=zzz')).status).toBe(404);
  });
  async function session(ctx: any) { const c = client(ctx.app); await c.login(DEMO.student); await c.get('/api/auth/me'); const s = await c.post('/api/voice/sessions', { mode: 'teach', lang: 'en', showBoth: true, saveTranscript: true }); ctx.c = c; return s.body.session.id as string; }
  it('a heart question returns a labelled diagram event; follow-ups explain / simplify / name a label', async () => {
    const ctx: any = await setup(); const id = await session(ctx);
    const t1 = await ctx.c.post(`/api/voice/sessions/${id}/turn`, { text: 'Explain the human heart' }); const v1 = t1.body.events.find((e: any) => e.type === 'visual');
    expect(v1.visuals[0].key.id).toBe('heart'); expect(v1.visuals[0].alt.en).toMatch(/atrium/);
    const t2 = await ctx.c.post(`/api/voice/sessions/${id}/turn`, { text: 'Show a simpler diagram' }); expect(t2.body.events.find((e: any) => e.type === 'visual').visuals[0].key.lvl).toBe('simple');
    const t3 = await ctx.c.post(`/api/voice/sessions/${id}/turn`, { text: 'What does the aorta label mean?' }); const c3 = t3.body.events.find((e: any) => e.type === 'chunk'); expect(c3.en).toMatch(/Aorta/); expect(t3.body.events.find((e: any) => e.type === 'visual').visuals[0].key.hl).toBe('aorta');
    const t4 = await ctx.c.post(`/api/voice/sessions/${id}/turn`, { text: 'Explain this diagram' }); expect(t4.body.events.find((e: any) => e.type === 'chunk').en).toMatch(/Blood returns/);
  });
  it('equation steps change the picture; saved transcript keeps the visuals for resume', async () => {
    const ctx: any = await setup(); const id = await session(ctx);
    const a = await ctx.c.post(`/api/voice/sessions/${id}/turn`, { text: 'Solve 3x + 5 = 20' }); const b = await ctx.c.post(`/api/voice/sessions/${id}/turn`, { text: 'yes' });
    const pa = a.body.events.filter((e: any) => e.type === 'visual').map((e: any) => e.visuals[0].key.p), pb = b.body.events.filter((e: any) => e.type === 'visual').map((e: any) => e.visuals[0].key.p);
    expect(pa[0]).toBe('3x + 5|20'); expect(pb[0]).not.toBe(pa[0]);
    const d = await ctx.c.get(`/api/voice/sessions/${id}`); expect(JSON.stringify(d.body.turns)).toContain('"visuals":[{');
  });
  it('asking about a diagram when none is shown says so honestly', async () => {
    const ctx: any = await setup(); const id = await session(ctx); const r = await ctx.c.post(`/api/voice/sessions/${id}/turn`, { text: 'Explain this diagram' });
    expect(r.body.events.find((e: any) => e.type === 'chunk').en).toMatch(/no diagram on screen/i); expect(r.body.events.some((e: any) => e.type === 'visual')).toBe(false);
  });
  it('a failing visual service never interrupts the lesson', async () => {
    const ctx: any = await setup({ voiceVisuals: () => { throw new Error('boom'); } }); const id = await session(ctx);
    const r = await ctx.c.post(`/api/voice/sessions/${id}/turn`, { text: 'Solve 3x + 5 = 20' }); expect(r.status).toBe(200);
    expect(r.body.events.filter((e: any) => e.type === 'chunk').length).toBeGreaterThan(1); expect(r.body.events.some((e: any) => e.type === 'visual')).toBe(false); expect(r.body.state.idx).toBeGreaterThanOrEqual(0);
  });
});
