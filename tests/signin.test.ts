import { beforeEach, describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { safeNext } from '../src/lib/safeNext';
import { q } from '../server/db';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });

describe('safe post-login redirect', () => {
  it('accepts in-app paths with query strings', () => {
    expect(safeNext('/app')).toBe('/app'); expect(safeNext('/app/learn/c8-maths-linear?tab=map')).toBe('/app/learn/c8-maths-linear?tab=map'); expect(safeNext('/profile')).toBe('/profile');
  });
  it('rejects external, protocol-relative, backslash, non-app and malformed targets', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '/app\\..\\x', 'javascript:alert(1)', '/admin', '/signin', '/appx', '', null, undefined, 42, '/app\n/x', '/' + 'a'.repeat(400)]) expect(safeNext(bad as any)).toBeNull();
  });
});

describe('sign-in API', () => {
  it('uses one message for unknown account and wrong password, and records both attempts', async () => {
    const a = await client(ctx.app).login('nobody@example.com', 'whatever123'); const b = await client(ctx.app).login(DEMO.student, 'wrong-password');
    expect(a.status).toBe(401); expect(b.status).toBe(401); expect(a.body.error ?? a.body.message).toBe(b.body.error ?? b.body.message);
    expect((await q.get<any>(ctx.db, "SELECT COUNT(*) n FROM audit WHERE action='auth.login_failed'"))!.n).toBe(2);
  });
  it('accepts email in any letter case and with spaces, and the demo username', async () => {
    expect((await client(ctx.app).login(`  ${DEMO.student.toUpperCase()} `)).status).toBe(200); expect((await client(ctx.app).login('vikikalvi')).status).toBe(200);
  });
  it('does not leak the password hash or other users in the response', async () => {
    const r = await client(ctx.app).login(DEMO.student); expect(JSON.stringify(r.body)).not.toMatch(/hash|scrypt/i); expect(Object.keys(r.body.user).sort()).toEqual(['display_name', 'email', 'id', 'role']);
  });
  it('keeps student-only learning APIs closed to other roles and signed-out visitors', async () => {
    for (const url of ['/api/dashboard', '/api/mindmaps/recent', '/api/lessons/c8-maths-linear/mindmap']) {
      expect([401, 403]).toContain((await client(ctx.app).get(url)).status);
      const t = client(ctx.app); await t.login(DEMO.teacher); expect(await t.get(url).then(r => r.status)).toBe(403);
      const p = client(ctx.app); await p.login(DEMO.parent); expect(await p.get(url).then(r => r.status)).toBe(403);
    }
  });
});
