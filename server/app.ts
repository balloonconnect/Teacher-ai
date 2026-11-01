import { tamilRoutes } from './routes/tamil';
import { structureRoutes } from './routes/structure';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { DB } from './db';
import { authMiddleware, csrfGuard } from './security';
import { errorHandler } from './http';
import { authRoutes } from './routes/auth';
import { profileRoutes } from './routes/profile';
import { studentRoutes } from './routes/student';
import { testRoutes } from './routes/tests';
import { tutorRoutes } from './routes/tutor';
import { materialRoutes } from './routes/materials';
import { textbookRoutes } from './routes/textbooks';
import { visualRoutes } from './routes/visuals';
import { voiceRoutes } from './routes/voice';
import type { TeachEngine } from './services/teach';
import { teacherRoutes } from './routes/teacher';
import { adminRoutes, parentRoutes, schoolRoutes } from './routes/roles';
import { selectProvider, TutorProvider } from './services/tutor';

export function createApp(db: DB, opts: { provider?: TutorProvider; serveStatic?: boolean; voiceEngine?: TeachEngine; voiceMax?: number; voiceQueueMs?: number; voiceVisuals?: any; voiceTts?: any; llm?: any } = {}) {
  const app = express();
  app.disable('x-powered-by'); app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '200kb' }));
  const api = express.Router();
  api.use(authMiddleware(db)); api.use(csrfGuard);
  const provider = opts.provider ?? selectProvider();
  api.get('/config', (_req, res) => res.json({ production: process.env.NODE_ENV === 'production', demoAccounts: process.env.NODE_ENV !== 'production', bookOnly: process.env.BOOK_ONLY === '1', aiProvider: provider.name, aiIsMock: provider.mock, ocrAvailable: !!process.env.ANTHROPIC_API_KEY, year: '2026–2027' }));
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRoutes(db));
  api.use('/profile', profileRoutes(db));
  api.use('/tutor', tutorRoutes(db, provider));
  api.use('/voice', voiceRoutes(db, opts.voiceEngine, { maxConcurrency: opts.voiceMax, queueMs: opts.voiceQueueMs, visuals: opts.voiceVisuals, tts: opts.voiceTts }));
  api.use('/tamil', tamilRoutes(db, { llm: opts.llm, tts: opts.voiceTts }));
  api.use('/visuals', visualRoutes());
  api.use('/materials', materialRoutes(db));
  api.use('/textbooks', textbookRoutes(db));
  api.use('/teacher', teacherRoutes(db));
  api.use('/parent', parentRoutes(db));
  api.use('/school', schoolRoutes(db));
  api.use('/admin', adminRoutes(db));
  api.use(testRoutes(db));
  api.use(structureRoutes(db, { llm: opts.llm }));
  api.use(studentRoutes(db));
  api.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);
  const dist = path.resolve('dist');
  if (opts.serveStatic !== false && fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
