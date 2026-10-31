// Real-browser Tamil check. Usage: BASE=http://localhost:3057 node scripts/tamil-browser-check.mjs [outDir]
// For each sample it records: the source string, the DOM text, whether the copied (selected) text equals the source, the computed font family,
// the font file the engine actually used for the glyphs (via DevTools CSS.getPlatformFontsForNode), the woff2 network requests and console errors.
import { createRequire } from 'node:module'; import { writeFileSync, mkdirSync } from 'node:fs'; const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://localhost:3057'; const out = process.argv[2] ?? '/tmp/tamil-check'; mkdirSync(out, { recursive: true });
const SRC = { A: 'தமிழ் மொழி இனிமையானது. கல்வி மனித வாழ்க்கைக்கு மிகவும் முக்கியமானது.', B: 'கல்வி, அறிவு, ஒழுக்கம், வாழ்க்கை, மகிழ்ச்சி, குழந்தைகள், திருக்குறள், கவிதை.', C: 'அகர முதல எழுத்தெல்லாம் ஆதி\nபகவன் முதற்றே உலகு.' };
const b = await chromium.launch(); const report = []; let failed = 0;
for (const [name, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 800 }]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: name === 'mobile' ? 2 : 1 }); const p = await ctx.newPage(); const fonts = [], errs = [];
  p.on('response', r => /\.woff2?(\?|$)/.test(r.url()) && fonts.push(`${r.status()} ${r.url().split('/').pop()}`)); p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(e.message));
  await p.goto(`${BASE}/tamil-test`); await p.waitForSelector('#t-A'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
  const cdp = await ctx.newCDPSession(p); await cdp.send('DOM.enable'); await cdp.send('CSS.enable'); const { root } = await cdp.send('DOM.getDocument');
  for (const k of Object.keys(SRC)) for (const id of [`t-${k}`, `t-${k}-bold`]) {
    const dom = await p.$eval(`#${id}`, e => e.textContent); const copied = await p.evaluate(sel => { const e = document.querySelector(sel); const r = document.createRange(); r.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString(); }, `#${id}`);
    const css = await p.$eval(`#${id}`, e => { const c = getComputedStyle(e); return { family: c.fontFamily, ls: c.letterSpacing, lh: c.lineHeight }; });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${id}` }); const { fonts: used } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    const row = { viewport: name, id, sourceEqualsDom: dom === SRC[k], sourceEqualsCopied: copied.replace(/\n+/g, '\n').trim() === SRC[k], nfc: dom === dom.normalize('NFC'), family: css.family, letterSpacing: css.ls, lineHeight: css.lh, platformFonts: used.map(f => `${f.familyName}${f.isCustomFont ? ' (web font)' : ' (system)'} ×${f.glyphCount}`), tamilGlyphsFromWebFont: used.some(f => /Noto Sans Tamil/i.test(f.familyName) && f.isCustomFont) };
    if (!(row.sourceEqualsDom && row.sourceEqualsCopied && row.nfc && row.tamilGlyphsFromWebFont && row.letterSpacing === 'normal')) failed++; report.push(row);
  }
  await p.screenshot({ path: `${out}/tamil-${name}.png`, fullPage: true }); report.push({ viewport: name, woff2Requests: fonts, consoleErrors: errs }); if (errs.length || !fonts.some(f => /noto-sans-tamil.*tamil/.test(f))) failed++;
  await ctx.close();
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 1)); await b.close(); console.log(failed ? `FAILED checks: ${failed}` : 'ALL TAMIL BROWSER CHECKS PASSED'); process.exit(failed ? 1 : 0);
