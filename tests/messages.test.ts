import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { q } from '../server/db';
import { setMailer } from '../server/services/mailer';
import { approvedMail, pendingMail, weeklyReportMail } from '../server/services/mailTemplates';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); setMailer(undefined); });

describe('parent and teacher messages', () => {
  it('lists the linked teacher for the parent and the linked parent for the teacher', async () => {
    const p = client(ctx.app); await p.login(DEMO.parent); const t = client(ctx.app); await t.login(DEMO.teacher);
    const pc = (await p.get('/api/messages/contacts')).body.contacts; const tc = (await t.get('/api/messages/contacts')).body.contacts;
    expect(pc.map((x: any) => x.id)).toEqual(['u-teacher']); expect(tc.map((x: any) => x.id)).toEqual(['u-parent']);
  });
  it('delivers a message both ways, counts it unread, notifies, and clears unread when read', async () => {
    const p = client(ctx.app); await p.login(DEMO.parent); const t = client(ctx.app); await t.login(DEMO.teacher);
    expect((await p.post('/api/messages/thread/u-teacher', { body: 'Hello teacher' })).status).toBe(201);
    expect((await t.get('/api/messages/contacts')).body.contacts[0].unread).toBe(1);
    expect((await q.get<any>(ctx.db, "SELECT COUNT(*) n FROM notifications WHERE user_id='u-teacher' AND title='New message'"))!.n).toBe(1);
    const th = (await t.get('/api/messages/thread/u-parent')).body.messages; expect(th).toHaveLength(1); expect(th[0]).toMatchObject({ body: 'Hello teacher', mine: false });
    expect((await t.get('/api/messages/contacts')).body.contacts[0].unread).toBe(0);
    expect((await t.post('/api/messages/thread/u-parent', { body: 'Hi, thanks' })).status).toBe(201);
    expect((await p.get('/api/messages/thread/u-teacher')).body.messages.map((m: any) => m.mine)).toEqual([true, false]);
  });
  it('refuses people outside the parent-teacher link, students and signed-out visitors', async () => {
    const p = client(ctx.app); await p.login(DEMO.parent);
    expect((await p.post('/api/messages/thread/u-student', { body: 'x' })).status).toBe(403);
    expect((await p.get('/api/messages/thread/u-arun')).status).toBe(403);
    const s = client(ctx.app); await s.login(DEMO.student); expect((await s.get('/api/messages/contacts')).status).toBe(403);
    expect((await client(ctx.app).get('/api/messages/contacts')).status).toBe(401);
  });
  it('rejects empty and over-long messages', async () => {
    const p = client(ctx.app); await p.login(DEMO.parent);
    expect((await p.post('/api/messages/thread/u-teacher', { body: '   ' })).status).toBe(400);
    expect((await p.post('/api/messages/thread/u-teacher', { body: 'a'.repeat(1001) })).status).toBe(400);
  });
});

describe('weekly reports', () => {
  it('returns weekly buckets only for a linked child', async () => {
    const p = client(ctx.app); await p.login(DEMO.parent);
    const ok = await p.get('/api/parent/children/u-student/reports'); expect(ok.status).toBe(200); expect(Array.isArray(ok.body.reports)).toBe(true);
    for (const w of ok.body.reports) { expect(w.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(w.attempted).toBeGreaterThan(0); }
    expect((await p.get('/api/parent/children/u-arun/reports')).status).toBe(403);
  });
  it('says plainly that email is not set up instead of pretending to send', async () => {
    const p = client(ctx.app); await p.login(DEMO.parent);
    const r = await p.post('/api/parent/children/u-student/reports/email', { weekStart: '2026-01-05' }); expect(r.status).toBe(400); expect(r.body.error).toMatch(/not set up/);
  });
});

describe('new email templates', () => {
  it('build bilingual mails with the right recipient and no raw HTML injection', () => {
    const a = approvedMail('t@x.in', 'Priya <b>K</b>', 'teacher'); expect(a.to).toBe('t@x.in'); expect(a.subject).toMatch(/approved/i); expect(a.html).not.toContain('<b>K</b>');
    expect(pendingMail('t@x.in', 'Priya').text).toMatch(/waiting|checked by an administrator/);
    const w = weeklyReportMail('p@x.in', 'Kumar', 'Meena', { weekLabel: '5 Jan – 11 Jan', attempted: 2, passed: 1, avgPct: 65, tests: [{ title: 'Algebra', pct: 70, status: 'Passed' }] }, 'https://x.in/parent/reports'); expect(w.text).toContain('Algebra'); expect(w.text).toContain('65%');
  });
});
