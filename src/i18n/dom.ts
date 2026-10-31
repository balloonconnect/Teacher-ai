import { translate } from './translate';

/**
 * Applies translate() to the text on the page and keeps doing it as React changes the page. Only text nodes and a few attributes are touched, so React's own
 * references stay valid; the original English is remembered so switching back restores it exactly.
 */
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'] as const;
const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'NOSCRIPT']);
const orig = new WeakMap<Node, { en: string; ta: string }>(); const attrOrig = new WeakMap<Element, Map<string, { en: string; ta: string }>>();
let on = false; let obs: MutationObserver | null = null; let raf = 0; const dirty = new Set<Node>();

const skipped = (el: Element | null) => { for (let e = el; e; e = e.parentElement) { if (SKIP.has(e.tagName) || e.hasAttribute('data-notranslate') || e.getAttribute('contenteditable') === 'true') return true; } return false; };
function text(n: Text) {
  const el = n.parentElement; if (!el || skipped(el)) return; const cur = n.nodeValue ?? ''; const rec = orig.get(n);
  if (rec && cur === rec.ta) return; // our own write
  const ta = translate(cur); if (ta === null) { if (rec) orig.delete(n); return; }
  const lead = /^\s*/.exec(cur)![0]; const trail = /\s*$/.exec(cur)![0]; const next = lead + ta + trail;
  orig.set(n, { en: cur, ta: next }); n.nodeValue = next;
}
function attrs(el: Element) {
  if (skipped(el)) return; let m = attrOrig.get(el);
  for (const a of ATTRS) {
    const cur = el.getAttribute(a); if (cur === null) continue; const rec = m?.get(a); if (rec && cur === rec.ta) continue;
    const ta = translate(cur); if (ta === null) { m?.delete(a); continue; }
    if (!m) { m = new Map(); attrOrig.set(el, m); } m.set(a, { en: cur, ta }); el.setAttribute(a, ta);
  }
}
function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return text(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element; if (skipped(el)) return; attrs(el);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let n: Node | null = w.nextNode();
  while (n) { if (n.nodeType === Node.TEXT_NODE) text(n as Text); else { const e = n as Element; if (skipped(e)) { n = skipSubtree(w, e); continue; } attrs(e); } n = w.nextNode(); }
}
function skipSubtree(w: TreeWalker, e: Element): Node | null { let n: Node | null = e; while (n && !n.nextSibling && n !== w.root) n = n.parentNode; if (!n || n === w.root) return null; w.currentNode = n; return w.nextNode(); }
function title() { const t = document.title; if (t && !(titleOrig && t === titleTa)) { const ta = translate(t); if (ta) { titleOrig = t; titleTa = ta; document.title = ta; } } }
let titleOrig = ''; let titleTa = '';
function flush() { raf = 0; const nodes = [...dirty]; dirty.clear(); for (const n of nodes) if (n.isConnected) walk(n); title(); }
function schedule(n: Node) { dirty.add(n); if (!raf) raf = requestAnimationFrame(flush); }

export function setTamilDom(enable: boolean) {
  if (typeof document === 'undefined') return;
  if (enable && !on) {
    on = true; document.documentElement.lang = 'ta'; walk(document.body); title();
    obs = new MutationObserver(ms => { for (const m of ms) { if (m.type === 'childList') m.addedNodes.forEach(schedule); else if (m.type === 'characterData') schedule(m.target); else if (m.type === 'attributes') schedule(m.target); } });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  } else if (!enable && on) {
    on = false; obs?.disconnect(); obs = null; document.documentElement.lang = 'en'; dirty.clear();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let n: Node | null = w.nextNode();
    while (n) { if (n.nodeType === Node.TEXT_NODE) { const r = orig.get(n); if (r && (n as Text).nodeValue === r.ta) (n as Text).nodeValue = r.en; orig.delete(n); } else { const m = attrOrig.get(n as Element); if (m) { for (const [a, r] of m) if ((n as Element).getAttribute(a) === r.ta) (n as Element).setAttribute(a, r.en); attrOrig.delete(n as Element); } } n = w.nextNode(); }
    if (titleOrig && document.title === titleTa) document.title = titleOrig; titleOrig = titleTa = '';
  }
}
