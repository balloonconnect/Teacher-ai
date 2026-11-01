import { mkdir, writeFile, readFile, unlink, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

/**
 * File storage for textbook PDFs and student uploads.
 *
 *   STORAGE_DRIVER=local  (default)  files under TEXTBOOK_DIR / UPLOAD_DIR  — fine for one server with a persistent disk
 *   STORAGE_DRIVER=s3                S3-compatible bucket (AWS S3, Cloudflare R2, Supabase Storage, MinIO, ...)
 *
 * The DB column `file_path` stores the storage key. Local keys are file paths (so older rows keep working);
 * S3 keys look like `textbooks/<id>.pdf`.
 */
export type Kind = 'textbooks' | 'uploads';
export interface Storage {
  readonly driver: 'local' | 's3';
  newKey(kind: Kind, ext: string): string;
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export class NotFound extends Error { constructor(key: string) { super(`No such file: ${key}`); } }

export function localStorage(dirs: { textbooks: string; uploads: string }): Storage {
  return {
    driver: 'local',
    newKey: (kind, ext) => join(dirs[kind], `${randomUUID()}.${ext}`),
    async put(key, data) { await mkdir(dirname(key), { recursive: true }); await writeFile(key, data, { mode: 0o600 }); },
    async get(key) { try { return await readFile(key); } catch { throw new NotFound(key); } },
    async stream(key) { if (!(await this.exists(key))) throw new NotFound(key); return createReadStream(key); },
    async exists(key) { try { await access(key); return true; } catch { return false; } },
    async delete(key) { try { await unlink(key); } catch { /* already gone */ } },
  };
}

export interface S3Options { bucket: string; region?: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string; prefix?: string; forcePathStyle?: boolean }

export function s3Storage(o: S3Options): Storage {
  let client: any; let sdk: any;
  const prefix = (o.prefix ?? '').replace(/^\/+|\/+$/g, ''); const full = (k: string) => (prefix ? `${prefix}/${k}` : k);
  const c = async () => {
    if (client) return client;
    sdk = await import('@aws-sdk/client-s3');
    client = new sdk.S3Client({
      region: o.region || 'auto', endpoint: o.endpoint || undefined, forcePathStyle: o.forcePathStyle ?? !!o.endpoint,
      credentials: o.accessKeyId && o.secretAccessKey ? { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } : undefined,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    });
    return client;
  };
  const missing = (e: any) => e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
  return {
    driver: 's3',
    newKey: (kind, ext) => `${kind}/${randomUUID()}.${ext}`,
    async put(key, data, contentType) { const cl = await c(); await cl.send(new sdk.PutObjectCommand({ Bucket: o.bucket, Key: full(key), Body: data, ContentType: contentType ?? 'application/octet-stream' })); },
    async get(key) {
      const cl = await c();
      try { const r = await cl.send(new sdk.GetObjectCommand({ Bucket: o.bucket, Key: full(key) })); return Buffer.from(await r.Body.transformToByteArray()); } catch (e) { if (missing(e)) throw new NotFound(key); throw e; }
    },
    async stream(key) {
      const cl = await c();
      try { const r = await cl.send(new sdk.GetObjectCommand({ Bucket: o.bucket, Key: full(key) })); return r.Body as Readable; } catch (e) { if (missing(e)) throw new NotFound(key); throw e; }
    },
    async exists(key) {
      const cl = await c();
      try { await cl.send(new sdk.HeadObjectCommand({ Bucket: o.bucket, Key: full(key) })); return true; } catch (e) { if (missing(e)) return false; throw e; }
    },
    async delete(key) { const cl = await c(); try { await cl.send(new sdk.DeleteObjectCommand({ Bucket: o.bucket, Key: full(key) })); } catch (e) { if (!missing(e)) throw e; } },
  };
}

/** Picks the driver from the environment. */
export function storageFromEnv(env = process.env): Storage {
  const driver = (env.STORAGE_DRIVER ?? (env.S3_BUCKET ? 's3' : 'local')).toLowerCase();
  if (driver === 's3') {
    if (!env.S3_BUCKET) throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET');
    return s3Storage({ bucket: env.S3_BUCKET, region: env.S3_REGION, endpoint: env.S3_ENDPOINT, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, prefix: env.S3_PREFIX, forcePathStyle: env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE === '1' : undefined });
  }
  return localStorage({ textbooks: env.TEXTBOOK_DIR ?? 'data/textbooks', uploads: env.UPLOAD_DIR ?? 'data/uploads' });
}

let shared: Storage | undefined;
/** Process-wide storage (tests can replace it). */
export const storage = (): Storage => (shared ??= storageFromEnv());
export const setStorage = (s: Storage | undefined) => { shared = s; };
