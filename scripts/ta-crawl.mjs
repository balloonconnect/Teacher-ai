/* global document, NodeFilter, getComputedStyle */
// Visits student/public/account screens in Tamil mode and lists every visible English phrase left. Usage: node ta-crawl.cjs [out.json]
import { createRequire } from 'node:module'; import fs from 'node:fs';
const require = createRequire(import.meta.url); const { chromium } = require('playwright'); // devDependency-free: `npm i -D playwright` or use a global install (NODE_PATH)
// Allowed Latin tokens: acronyms and brand/tech names that stay as they are in Tamil text, plus names and emails typed by users (TA_ALLOW=regex adds more).
const KEEP = new RegExp('\\b(?:AI|PDF|OCR|QR|IST|MB|JPG|PNG|WebP|Chrome|Edge|Safari|Android|https?|DELETE|KM-[A-Z0-9]+|Childline|WebM|MP3|Q\\d+|[A-Za-z]+@[\\w.-]+|' + (process.env.TA_ALLOW || 'Meenakshi Kumar|Ravi plays football|Ravi|Raju|Kumar') + ')\\b', 'g');
const english = t => /[A-Za-z]{2}/.test(t.replace(/^(?:ATTR|TITLE):/, '').replace(KEEP, ''));
const BASE = process.env.BASE_URL || 'http://localhost:3056';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, baseURL: BASE });
  ctx.setDefaultTimeout(3000); ctx.setDefaultNavigationTimeout(8000); await ctx.addInitScript(() => localStorage.setItem('lang', 'ta'));
  const left = {}; const add = (route, list) => { for (const t of list.filter(english)) { (left[t] ??= new Set()).add(route); } };
  const scan = async (p, route) => { await p.waitForTimeout(900); const r = await p.evaluate(() => { const res = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const el = n.parentElement; if (!el || ['SCRIPT','STYLE','CODE','PRE','TEXTAREA'].includes(el.tagName) || el.closest('[data-notranslate]')) continue; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const t = n.textContent.replace(/\s+/g, ' ').trim(); res.push(t); } for (const e of document.querySelectorAll('[placeholder],[aria-label],[title],[alt]')) for (const a of ['placeholder','aria-label','title','alt']) { const v = e.getAttribute(a); if (v && /[A-Za-z]{2}/.test(v)) res.push('ATTR:' + v); } if (/[A-Za-z]{2}/.test(document.title)) res.push('TITLE:' + document.title); return res; }); add(route, r); };
  const visit = (route, fn) => Promise.race([visit0(route, fn), new Promise(r => setTimeout(() => { console.log('TIMEOUT', route); r(); }, 25000).unref())]);
  const visit0 = async (route, fn) => { console.log('visit', route); const p = await ctx.newPage(); await p.goto(route); await p.waitForTimeout(600); if (fn) { try { await fn(p); } catch (e) { console.log('step failed on', route, e.message.split('\n')[0]); } } await scan(p, route); await p.close(); };
  
  for (const r of ['/', '/features', '/how-it-works', '/privacy', '/terms', '/child-safety', '/signin', '/signup', '/forgot-password', '/reset-password?token=x', '/verify-email?token=x', '/guardian-approval?token=x', '/verify', '/nope-404']) await visit(r);
  await visit('/signin', async p => { await p.getByRole('button', { name: /^Sign in$|^உள்நுழை/ }).last().click(); });
  await visit('/signup', async p => { await p.selectOption('select', 'student').catch(()=>{}); });
  const lg = await ctx.request.post('/api/auth/login', { data: { email: 'meena@demo.kavli.local', password: 'demo@12345' } }); if (!lg.ok()) { console.log('login failed'); process.exit(1); }
  for (const r of ['/app', '/app/learn', '/app/tutor', '/app/voice', '/app/material', '/app/practice', '/app/tests', '/app/progress', '/app/certificates', '/app/bookmarks', '/app/settings', '/app/books', '/app/notifications']) await visit(r);
  const api = async u => (await ctx.request.get('/api' + u)).json();
  const lessons = (await api('/lessons')).lessons ?? []; if (lessons[0]) { await visit('/app/learn/' + lessons[0].id); await visit('/app/learn/' + lessons[0].id, async p => { for (const t of await p.getByRole('tab').all()) { await t.click().catch(()=>{}); await p.waitForTimeout(300); } }); }
  const tests = (await api('/tests')).tests ?? []; for (const t of tests.slice(0, 3)) await visit('/app/tests/' + t.id);
  const tw = tests.find(t => t.status === 'available' || /Available|open/i.test(JSON.stringify(t.state ?? ''))) ?? tests[0]; if (tw) await visit('/app/tests/' + tw.id, async p => { await p.getByRole('button', { name: /start|தொடங்/i }).first().click(); await p.waitForTimeout(1500); });
  await visit('/app/tutor', async p => { const box = p.locator('textarea, input[type=text]').last(); await box.fill('Solve 3x + 5 = 20'); await box.press('Enter'); await p.waitForTimeout(2500); });
  await visit('/app/voice', async p => { await p.getByRole('button', { name: /Start conversation|உரையாடலைத்/ }).first().click(); await p.waitForTimeout(1500); });
  await visit('/app/practice', async p => { await p.getByRole('button', { name: /Start practice|பயிற்சியைத்/ }).first().click(); await p.waitForTimeout(1500); });
  await visit('/profile'); await visit('/app/mindmap'); 
  const out = Object.fromEntries(Object.entries(left).map(([t, rs]) => [t, [...rs].slice(0, 3)])); fs.writeFileSync(process.argv[2] || 'ta-left.json', JSON.stringify(out, null, 1));
  console.log('distinct English phrases left:', Object.keys(out).length); for (const [t, rs] of Object.entries(out)) console.log(' •', t.slice(0, 120), '←', rs[0]); await b.close(); process.exit(Object.keys(out).length ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
