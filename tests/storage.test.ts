import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localStorage, s3Storage, setStorage, storageFromEnv, NotFound, type Storage } from '../server/services/storage';
import { client, DEMO, setup } from './helpers';

/** A tiny in-memory S3 (path-style PUT/GET/HEAD/DELETE) — enough to exercise the real AWS SDK client. Records what it saw. */
function mockS3() {
  const objects = new Map<string, { body: Buffer; type: string }>(); const seen: { method: string; url: string; auth?: string }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization });
      const key = decodeURIComponent((req.url ?? '').split('?')[0]);
      if (req.method === 'PUT') { objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers['content-type'] ?? '') }); res.writeHead(200, { ETag: '"x"' }); return res.end(); }
      const o = objects.get(key);
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      if (!o) { res.writeHead(404, { 'content-type': 'application/xml' }); return res.end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>'); }
      res.writeHead(200, { 'content-type': o.type, 'content-length': o.body.length, ETag: '"x"' }); res.end(req.method === 'HEAD' ? undefined : o.body);
    });
  });
  return { server, objects, seen, listen: () => new Promise<string>(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as any).port}`))), close: () => new Promise(r => server.close(() => r(null))) };
}
const read = async (s: Storage, key: string) => { const out: Buffer[] = []; for await (const c of await s.stream(key)) out.push(Buffer.from(c)); return Buffer.concat(out); };

async function contract(s: Storage) {
  const key = s.newKey('uploads', 'png'); expect(await s.exists(key)).toBe(false);
  await s.put(key, Buffer.from('hello world'), 'image/png');
  expect(await s.exists(key)).toBe(true); expect((await s.get(key)).toString()).toBe('hello world'); expect((await read(s, key)).toString()).toBe('hello world');
  await s.delete(key); expect(await s.exists(key)).toBe(false);
  await expect(s.get(key)).rejects.toBeInstanceOf(NotFound); await expect(s.stream(key)).rejects.toBeInstanceOf(NotFound);
  await s.delete(key); // deleting twice is fine
}

describe('file storage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kavli-st-')); afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const s3 = mockS3(); let endpoint = '';
  beforeAll(async () => { endpoint = await s3.listen(); }); afterAll(() => s3.close()); afterEach(() => setStorage(undefined));
  const mkS3 = (prefix?: string) => s3Storage({ bucket: 'kavli', endpoint, region: 'auto', accessKeyId: 'AK', secretAccessKey: 'SK', prefix });

  it('local driver satisfies the storage contract', async () => { await contract(localStorage({ textbooks: join(dir, 'tb'), uploads: join(dir, 'up') })); });
  it('S3 driver satisfies the same contract, signs requests, and honours the key prefix', async () => {
    await contract(mkS3('prod'));
    expect(s3.seen.length).toBeGreaterThan(4); expect(s3.seen.every(r => /AWS4-HMAC-SHA256/.test(r.auth ?? ''))).toBe(true);
    expect(s3.seen.some(r => r.method === 'PUT' && r.url.startsWith('/kavli/prod/uploads/'))).toBe(true);
  });
  it('chooses the driver from the environment and refuses a half-configured S3', () => {
    expect(storageFromEnv({} as any).driver).toBe('local'); expect(storageFromEnv({ S3_BUCKET: 'b' } as any).driver).toBe('s3');
    expect(() => storageFromEnv({ STORAGE_DRIVER: 's3' } as any)).toThrow(/S3_BUCKET/);
  });
  it('textbook upload, download and delete work end to end against S3 storage (the PDF never touches local disk)', async () => {
    setStorage(mkS3()); const ctx = await setup();
    const PDFDocument = (await import('pdfkit')).default; const doc = new PDFDocument(); const bufs: Buffer[] = []; doc.on('data', (b: Buffer) => bufs.push(b)); doc.text('The Zephyrian obsidian volcano erupts every forty years and forms volcanic glass.'); doc.end(); await new Promise(r => doc.on('end', r));
    const a = client(ctx.app); await a.login(DEMO.admin); const csrf = (await a.get('/api/auth/me')).body.csrf;
    const up = await a.agent.post('/api/textbooks').set('x-csrf-token', csrf).field('title', 'S3 book').field('classLevel', '8').field('medium', 'English').attach('file', Buffer.concat(bufs), 'b.pdf'); expect(up.status).toBe(201);
    const key = [...s3.objects.keys()].find(k => k.startsWith('/kavli/textbooks/')); expect(key).toBeTruthy();
    const s = client(ctx.app); await s.login(DEMO.student); const f = await s.get(`/api/textbooks/${up.body.textbook.id}/file`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(f.status).toBe(200); expect(Buffer.from(f.body).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await a.del(`/api/textbooks/${up.body.textbook.id}`)).status).toBe(200); expect(s3.objects.has(key!)).toBe(false);
  });
});
