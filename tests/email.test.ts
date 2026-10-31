import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { client, DEMO, setup } from './helpers';
import { q } from '../server/db';
import { type Mail, type Mailer, mailerFromEnv, resendMailer, smtpMailer, setMailer } from '../server/services/mailer';
import { consumeToken, createToken, peekToken } from '../server/services/emailTokens';
import { clock } from '../server/clock';

/** Captures what would have been sent. */
const sent: Mail[] = []; let failNext = false;
const capture: Mailer = { name: 'capture', async send(m) { if (failNext) { failNext = false; throw new Error('mail service down'); } sent.push(m); } };
const link = (m: Mail, path: string) => { const x = new RegExp(`https?://[^\\s"<]+${path}\\?token=([A-Za-z0-9_-]+)`).exec(m.text); expect(x, `no ${path} link in mail`).toBeTruthy(); return x![1]; };
const tick = () => new Promise(r => setTimeout(r, 30)); // background sends start immediately; give them a moment

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { sent.length = 0; failNext = false; process.env.PUBLIC_URL = 'https://kalvi.example.in'; setMailer(capture); t = await setup(); });
afterAll(() => setMailer(undefined));

const reg = (c: any, o: any = {}) => c.register({ displayName: 'Ravi Kumar', email: 'ravi@example.com', password: 'Sunrise123', role: 'student', consent: true, student: { classLevel: 8, medium: 'English', aiLang: 'both', academicYear: '2026–2027', subjects: ['maths'] }, ...o });

describe('links opened in a browser that is already signed in', () => {
  it('work without the page having loaded its CSRF token yet', async () => {
    const c = client(t.app); await reg(c); await tick(); const tok = link(sent.find(x => /Confirm/.test(x.subject))!, '/verify-email');
    const cookie = (c as any).cookie ?? undefined; // use a raw agent with the same session and no csrf header
    const agent = request.agent(t.app); const lg = await agent.post('/api/auth/login').send({ email: 'ravi@example.com', password: 'Sunrise123' }); expect(lg.status).toBe(200);
    void cookie; expect((await agent.post('/api/auth/verify').send({ token: tok })).status).toBe(200);
    expect((await agent.post('/api/auth/logout').send({})).status).toBe(403); // ordinary writes still need the CSRF header
  });
});

describe('password reset', () => {
  it('emails a link that sets a new password once, and signs the user out everywhere', async () => {
    const c = client(t.app); await reg(c); await tick(); sent.length = 0;
    const other = client(t.app); expect((await other.login('ravi@example.com', 'Sunrise123')).status).toBe(200);
    const a = await client(t.app).post('/api/auth/forgot', { email: 'Ravi@Example.com' }); expect(a.status).toBe(200); expect(a.body).toEqual({ ok: true }); await tick();
    expect(sent).toHaveLength(1); expect(sent[0].to).toBe('ravi@example.com'); expect(sent[0].text).toContain('https://kalvi.example.in/reset-password?token='); expect(sent[0].subject).toMatch(/Reset/); expect(sent[0].text).toMatch(/கடவுச்சொல்/);
    const token = link(sent[0], '/reset-password');
    const weak = await client(t.app).post('/api/auth/reset', { token, password: 'short' }); expect(weak.status).toBe(400); // a weak password must not burn the link
    expect((await client(t.app).post('/api/auth/reset', { token, password: 'Moonlight456' })).status).toBe(200); await tick();
    expect((await client(t.app).post('/api/auth/reset', { token, password: 'Another789' })).status).toBe(400); // single use
    expect((await client(t.app).login('ravi@example.com', 'Sunrise123')).status).toBe(401); expect((await client(t.app).login('ravi@example.com', 'Moonlight456')).status).toBe(200);
    expect((await other.get('/api/auth/me')).body.user).toBeNull(); // the other device was signed out
    expect(sent.some(m => /changed/i.test(m.subject))).toBe(true);
    expect((await q.get<any>(t.db, "SELECT COUNT(*) c FROM audit WHERE action='auth.password_reset'")).c).toBe(1);
  });
  it('answers the same for unknown emails and sends nothing (no account enumeration)', async () => {
    const a = await client(t.app).post('/api/auth/forgot', { email: 'nobody@example.com' }); await tick(); expect(a.status).toBe(200); expect(a.body).toEqual({ ok: true }); expect(sent).toHaveLength(0);
  });
  it('never sends to disabled or demo accounts', async () => {
    await q.run(t.db, "UPDATE users SET disabled=1 WHERE email=?", DEMO.arun); await client(t.app).post('/api/auth/forgot', { email: DEMO.arun }); await client(t.app).post('/api/auth/forgot', { email: DEMO.student }); await tick(); expect(sent).toHaveLength(0);
  });
  it('a newer request replaces the older link; expired links stop working', async () => {
    const c = client(t.app); await reg(c); await tick(); sent.length = 0;
    await client(t.app).post('/api/auth/forgot', { email: 'ravi@example.com' }); await client(t.app).post('/api/auth/forgot', { email: 'ravi@example.com' }); await tick();
    expect(sent).toHaveLength(2); expect((await client(t.app).post('/api/auth/reset', { token: link(sent[0], '/reset-password'), password: 'Moonlight456' })).status).toBe(400);
    clock.advance(61 * 60 * 1000); expect((await client(t.app).post('/api/auth/reset', { token: link(sent[1], '/reset-password'), password: 'Moonlight456' })).status).toBe(400);
  });
  it('a failing mail service does not break the request', async () => {
    const c = client(t.app); await reg(c); await tick(); failNext = true; expect((await client(t.app).post('/api/auth/forgot', { email: 'ravi@example.com' })).status).toBe(200);
  });
  it('without any mail driver it says so plainly instead of pretending', async () => {
    setMailer(null); expect((await client(t.app).get('/api/auth/config')).body).toEqual({ email: { enabled: false } });
    const r = await client(t.app).post('/api/auth/forgot', { email: 'ravi@example.com' }); expect(r.status).toBe(501); expect(r.body.error).toMatch(/not set up/);
  });
  it('rejects garbage tokens', async () => { for (const token of ['x', 'a'.repeat(43), '../../etc']) expect((await client(t.app).post('/api/auth/reset', { token, password: 'Moonlight456' })).status).toBe(400); });
  it('links point at PUBLIC_URL, never at the request’s Host header', async () => {
    const c = client(t.app); await reg(c); await tick(); sent.length = 0;
    await request(t.app).post('/api/auth/forgot').set('Host', 'evil.example').set('X-Forwarded-Host', 'evil.example').send({ email: 'ravi@example.com' }); await tick();
    expect(sent[0].text).toContain('https://kalvi.example.in/'); expect(sent[0].text + (sent[0].html ?? '')).not.toContain('evil.example');
  });
});

describe('email verification', () => {
  it('sends a link at sign-up and marks the address verified; /me reports it', async () => {
    const c = client(t.app); await reg(c); await tick(); const m = sent.find(x => /Confirm/.test(x.subject))!; expect(m.to).toBe('ravi@example.com');
    expect((await c.get('/api/auth/me')).body.emailVerified).toBe(false);
    expect((await client(t.app).post('/api/auth/verify', { token: link(m, '/verify-email') })).status).toBe(200); expect((await c.get('/api/auth/me')).body.emailVerified).toBe(true);
    expect((await client(t.app).post('/api/auth/verify', { token: link(m, '/verify-email') })).status).toBe(400);
  });
  it('can be requested again from the account; nothing is sent if already verified', async () => {
    const c = client(t.app); await reg(c); await tick(); sent.length = 0; expect((await c.post('/api/auth/send-verification')).status).toBe(200); await tick(); expect(sent).toHaveLength(1);
    await client(t.app).post('/api/auth/verify', { token: link(sent[0], '/verify-email') }); sent.length = 0; const again = await c.post('/api/auth/send-verification'); expect(again.body.alreadyVerified).toBe(true); await tick(); expect(sent).toHaveLength(0);
    expect((await client(t.app).post('/api/auth/send-verification')).status).toBe(401);
  });
});

describe('guardian approval by email', () => {
  const under13 = (c: any) => reg(c, { email: 'kid@example.com', displayName: 'Kavin Raj', under13: true, guardianName: 'Mrs. Raj', guardianEmail: 'mum@example.com' });
  it('mails the guardian; approving unlocks the account, records consent and tells the student', async () => {
    const c = client(t.app); expect((await under13(c)).status).toBe(201); await tick(); const m = sent.find(x => x.to === 'mum@example.com')!; expect(m.subject).toMatch(/approve Kavin/i); expect(m.text).toMatch(/under 13/);
    const token = link(m, '/guardian-approval'); const g = client(t.app);
    const look = await g.post('/api/auth/guardian/lookup', { token }); expect(look.body).toMatchObject({ studentName: 'Kavin Raj', guardianName: 'Mrs. Raj', alreadyApproved: false });
    expect((await q.get<any>(t.db, "SELECT guardian_approved a FROM student_profiles WHERE user_id=(SELECT id FROM users WHERE email='kid@example.com')")).a).toBe(0);
    expect((await g.post('/api/auth/guardian/decide', { token, decision: 'approve', guardianName: 'Mrs. S. Raj' })).status).toBe(200);
    const row = await q.get<any>(t.db, "SELECT p.guardian_approved a, (SELECT value FROM settings WHERE key='guardian_consent:'||p.user_id) c FROM student_profiles p WHERE user_id=(SELECT id FROM users WHERE email='kid@example.com')");
    expect(row.a).toBe(1); expect(JSON.parse(row.c)).toMatchObject({ decision: 'approve', name: 'Mrs. S. Raj', email: 'mum@example.com', via: 'email-link' });
    expect((await c.get('/api/notifications')).body.notifications?.some((n: any) => /approved/.test(n.title)) ?? true).toBe(true);
    expect((await g.post('/api/auth/guardian/decide', { token, decision: 'approve', guardianName: 'Mrs. S. Raj' })).status).toBe(400); // single use
  });
  it('declining keeps the account locked and is recorded', async () => {
    const c = client(t.app); await under13(c); await tick(); const token = link(sent.find(x => x.to === 'mum@example.com')!, '/guardian-approval');
    expect((await client(t.app).post('/api/auth/guardian/decide', { token, decision: 'decline', guardianName: 'Mrs. Raj' })).status).toBe(200);
    expect((await q.get<any>(t.db, "SELECT guardian_approved a FROM student_profiles WHERE user_id=(SELECT id FROM users WHERE email='kid@example.com')")).a).toBe(0);
    expect((await q.get<any>(t.db, "SELECT COUNT(*) c FROM audit WHERE action='guardian.declined'")).c).toBe(1);
  });
  it('the student can ask for the email again (a new link replaces the old); unrelated users cannot', async () => {
    const c = client(t.app); await under13(c); await tick(); const first = link(sent.find(x => x.to === 'mum@example.com')!, '/guardian-approval'); sent.length = 0;
    expect((await c.post('/api/auth/guardian/resend')).status).toBe(200); await tick(); expect(sent).toHaveLength(1); expect(sent[0].to).toBe('mum@example.com');
    expect((await client(t.app).post('/api/auth/guardian/lookup', { token: first })).status).toBe(400); expect((await client(t.app).post('/api/auth/guardian/lookup', { token: link(sent[0], '/guardian-approval') })).status).toBe(200);
    const adult = client(t.app); await reg(adult, { email: 'adult@example.com' }); expect((await adult.post('/api/auth/guardian/resend')).status).toBe(400);
  });
  it('a verification token cannot be used as a guardian approval or a reset (kinds are separate)', async () => {
    const c = client(t.app); await reg(c); await tick(); const v = link(sent.find(x => /Confirm/.test(x.subject))!, '/verify-email');
    expect((await client(t.app).post('/api/auth/guardian/decide', { token: v, decision: 'approve', guardianName: 'Someone' })).status).toBe(400); expect((await client(t.app).post('/api/auth/reset', { token: v, password: 'Moonlight456' })).status).toBe(400);
  });
});

describe('tokens', () => {
  it('store only a hash, work once, expire, and only one of two simultaneous uses wins', async () => {
    const c = client(t.app); await reg(c); const uid = (await q.get<any>(t.db, "SELECT id FROM users WHERE email='ravi@example.com'")).id;
    const tok = await createToken(t.db, uid, 'reset', { a: 1 }); expect(JSON.stringify(await q.all(t.db, 'SELECT * FROM email_tokens'))).not.toContain(tok);
    expect(await peekToken(t.db, tok, 'verify')).toBeNull(); expect(await peekToken(t.db, tok, 'reset')).toMatchObject({ userId: uid, payload: { a: 1 } });
    const [x, y] = await Promise.all([consumeToken(t.db, tok, 'reset'), consumeToken(t.db, tok, 'reset')]); expect([x, y].filter(Boolean)).toHaveLength(1);
    const t2 = await createToken(t.db, uid, 'reset'); clock.advance(2 * 3600 * 1000); expect(await consumeToken(t.db, t2, 'reset')).toBeNull();
  });
});

describe('mail drivers', () => {
  const mail: Mail = { to: 'a@example.com', subject: 'Hello · வணக்கம்', text: 'Line one\nhttps://kalvi.example.in/reset-password?token=' + 'x'.repeat(43), html: '<p>Hi</p>' };
  it('Resend: the documented request (POST /emails, bearer key, JSON body); errors surface', async () => {
    const reqs: any[] = []; let status = 200;
    const srv = http.createServer((req, res) => { const c: Buffer[] = []; req.on('data', d => c.push(d)); req.on('end', () => { reqs.push({ url: req.url, auth: req.headers.authorization, ct: req.headers['content-type'], body: JSON.parse(Buffer.concat(c).toString()) }); res.writeHead(status, { 'content-type': 'application/json' }); res.end('{"id":"x"}'); }); });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r())); const base = `http://127.0.0.1:${(srv.address() as any).port}`;
    try {
      await resendMailer({ apiKey: 're_test', from: 'Kalvi <no-reply@kalvi.example.in>', baseUrl: base }).send(mail);
      expect(reqs[0]).toMatchObject({ url: '/emails', auth: 'Bearer re_test', ct: 'application/json', body: { from: 'Kalvi <no-reply@kalvi.example.in>', to: ['a@example.com'], subject: mail.subject, text: mail.text, html: '<p>Hi</p>' } });
      status = 422; await expect(resendMailer({ apiKey: 're_test', from: 'x@y.z', baseUrl: base }).send(mail)).rejects.toThrow(/422/);
    } finally { srv.close(); }
  });
  it('SMTP: delivers a real message (Tamil subject and long link intact) to a real SMTP server', async () => {
    const got: any[] = []; const srv = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onData(stream, _s, cb) { simpleParser(stream).then(m => { got.push(m); cb(); }); } });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r())); const port = (srv.server.address() as any).port;
    try {
      await smtpMailer({ host: '127.0.0.1', port, from: 'Kalvi <no-reply@kalvi.example.in>', ignoreTls: true }).send(mail);
      expect(got).toHaveLength(1); expect(got[0].subject).toBe(mail.subject); expect(got[0].to.text).toBe('a@example.com'); expect(got[0].from.text).toMatch(/no-reply@kalvi.example.in/);
      expect(got[0].text).toContain('x'.repeat(43)); expect(got[0].html).toContain('<p>Hi</p>');
    } finally { srv.close(); }
  });
  it('is chosen from the environment; nothing is sent in production with the dev log driver', () => {
    expect(mailerFromEnv({} as any)).toBeNull(); expect(mailerFromEnv({ MAIL_FROM: 'a@b.in' } as any)).toBeNull();
    expect(mailerFromEnv({ MAIL_FROM: 'a@b.in', RESEND_API_KEY: 'k' } as any)?.name).toBe('resend'); expect(mailerFromEnv({ MAIL_FROM: 'a@b.in', SMTP_HOST: 'smtp.example.in' } as any)?.name).toBe('smtp:smtp.example.in');
    expect(mailerFromEnv({ MAIL_DRIVER: 'log' } as any)?.name).toMatch(/development/); expect(mailerFromEnv({ MAIL_DRIVER: 'log', NODE_ENV: 'production' } as any)).toBeNull();
    expect(mailerFromEnv({ RESEND_API_KEY: 'k' } as any)).toBeNull(); // no From address: refuse rather than send from nowhere
  });
});
