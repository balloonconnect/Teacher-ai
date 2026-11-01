import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, put, msg } from '../api';
import { Async, Badge, Button, Card, Icon, useLoad } from './ui';
import { Lang, useLang } from './lang';
import { useToast } from './toast';

export type MNode = { id: string; parent: string | null; kind: string; level: 'simple' | 'detailed'; rev: boolean; en: string; ta: string; detail_en?: string; detail_ta?: string };
export type MMap = { lessonId: string; title_en: string; title_ta: string; source: string; sourceNote: string; defaultMode: Mode; nodes: MNode[] };
export type Mode = 'simple' | 'detailed' | 'revision';
type State = { understood: string[]; revision: string[] };
const MODES: [Mode, string, string][] = [['simple', 'Simple', 'Main ideas only'], ['detailed', 'Detailed', 'Definitions, examples and steps'], ['revision', 'Quick revision', 'Key points for exams']];
const KIND_LABEL: Record<string, string> = { definition: 'DEFINITION', formula: 'FORMULA', example: 'EXAMPLE', mistake: 'WATCH OUT', tip: 'TIP' };
const PALETTE: [string, string][] = [['#e8f0fb', '#0a3d91'], ['#d9f4f0', '#0d9488'], ['#fef3c7', '#b45309'], ['#fce7f3', '#be185d'], ['#dcfce7', '#15803d'], ['#f3e8ff', '#7e22ce'], ['#e0f2fe', '#0369a1']];
const W = 224, GAPX = 64, GAPY = 12, FONT_EN = 14, FONT_TA = 14;

/** Schema check on the client too: a malformed payload shows an error state instead of crashing or rendering. */
export function validMap(m: any): m is MMap {
  if (!m || !Array.isArray(m.nodes) || !m.nodes.length || m.nodes.length > 200) return false;
  const ids = new Set<string>(); let roots = 0;
  for (const n of m.nodes) { if (typeof n?.id !== 'string' || typeof n.en !== 'string' || typeof n.ta !== 'string' || ids.has(n.id)) return false; ids.add(n.id); if (n.parent === null) roots++; }
  return roots === 1 && m.nodes.every((n: MNode) => n.parent === null || ids.has(n.parent));
}
function wrap(text: string, max: number, lines = 3): string[] {
  const out: string[] = []; let cur = '';
  for (const w of text.split(/\s+/)) {
    let word = w; while (word.length > max) { if (cur) { out.push(cur); cur = ''; } out.push(word.slice(0, max)); word = word.slice(max); }
    if (!cur) cur = word; else if ((cur + ' ' + word).length <= max) cur += ' ' + word; else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  if (out.length > lines) { const k = out.slice(0, lines); k[lines - 1] = k[lines - 1].replace(/.?.?$/, '') + '…'; return k; }
  return out;
}
type Box = { n: MNode; x: number; y: number; h: number; depth: number; enL: string[]; taL: string[]; color: [string, string]; kids: string[] };

export function layoutMap(nodes: MNode[], show: Set<string>, collapsed: Set<string>, lang: Lang) {
  const by = new Map(nodes.map(n => [n.id, n])); const kids = new Map<string, string[]>();
  for (const n of nodes) if (n.parent && show.has(n.id)) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
  const root = nodes.find(n => n.parent === null)!; const boxes = new Map<string, Box>();
  const top = nodes.filter(n => n.parent === root.id); const colorOf = (n: MNode): [string, string] => { let c = n; while (c.parent && c.parent !== root.id) c = by.get(c.parent)!; const i = top.findIndex(t => t.id === c.id); return c.id === root.id ? ['#0a3d91', '#ffffff'] : PALETTE[Math.max(0, i) % PALETTE.length]; };
  let cursor = 0;
  const shift = (id: string, dy: number) => { const b = boxes.get(id)!; b.y += dy; if (!collapsed.has(id)) for (const k of kids.get(id) ?? []) shift(k, dy); };
  const place = (id: string, depth: number): void => {
    const n = by.get(id)!; const enL = lang === 'ta' ? [] : wrap(n.en, 26); const taL = lang === 'en' ? [] : wrap(n.ta, 22);
    const kind = KIND_LABEL[n.kind] ? 14 : 0; const h = 18 + kind + enL.length * 19 + taL.length * 22 + (enL.length && taL.length ? 2 : 0);
    const ks = collapsed.has(id) ? [] : kids.get(id) ?? []; const start = cursor; let y: number;
    boxes.set(id, { n, x: depth * (W + GAPX), y: 0, h, depth, enL, taL, color: colorOf(n), kids: kids.get(id) ?? [] });
    if (!ks.length) { y = cursor; cursor += h + GAPY; }
    else { for (const k of ks) place(k, depth + 1); const f = boxes.get(ks[0])!, l = boxes.get(ks[ks.length - 1])!; y = (f.y + f.h / 2 + l.y + l.h / 2) / 2 - h / 2;
      if (y < start) { const d = start - y; for (const k of ks) shift(k, d); y = start; cursor += d; } cursor = Math.max(cursor, y + h + GAPY); }
    boxes.get(id)!.y = y;
  };
  place(root.id, 0);
  const list = [...boxes.values()]; const maxX = Math.max(...list.map(b => b.x + W)), maxY = Math.max(...list.map(b => b.y + b.h));
  return { boxes, list, width: maxX, height: maxY, rootId: root.id };
}

export function useMindMap(lessonId: string, skip = false) {
  const s = useLoad(() => (skip ? Promise.resolve(null) : get(`/lessons/${lessonId}/mindmap`)), [lessonId, skip]);
  const bad = !!s.data && !validMap(s.data.map);
  return { s: bad ? { ...s, data: null, error: 'This mind map could not be shown because its data was not valid.' } : s, raw: s.data };
}
export function modeShow(m: MMap, mode: Mode): Set<string> {
  const by = new Map(m.nodes.map(n => [n.id, n])); const show = new Set<string>();
  if (mode === 'detailed') return new Set(m.nodes.map(n => n.id));
  for (const n of m.nodes) if (mode === 'simple' ? n.level === 'simple' || n.parent === null : n.rev || n.parent === null) { let c: MNode | undefined = n; while (c && !show.has(c.id)) { show.add(c.id); c = c.parent ? by.get(c.parent) : undefined; } }
  return show;
}
export const anchorFor = (id: string): { tab: 'explain' | 'examples'; el: string | null } => id.startsWith('sec-') ? { tab: 'explain', el: `lesson-${id.split('-').slice(0, 2).join('-')}` } : id.startsWith('vocab') ? { tab: 'explain', el: 'lesson-vocab' } : id.startsWith('goal') || id === 'goals' ? { tab: 'explain', el: null } : { tab: 'examples', el: null };

/** `mapUrl` shows a map for one item or the whole chapter of a book lesson (built from the structured view); marks on those maps are not saved. */
export function MindMapView({ lessonId, subjectId, onOpenLesson, mapUrl }: { lessonId: string; subjectId?: string; onOpenLesson: (a: { tab: 'explain' | 'examples'; el: string | null }) => void; mapUrl?: string }) {
  const own = useMindMap(lessonId, !!mapUrl).s;
  const ext = useLoad(() => (mapUrl ? get(mapUrl) : Promise.resolve(null)), [mapUrl]);
  if (mapUrl) return <Async s={ext}>{d => (d && validMap(d.map) ? <><Inner key={mapUrl} local lessonId={lessonId} map={d.map as MMap} initial={{ understood: [], revision: [], viewedAt: null } as any} subjectId={subjectId} onOpenLesson={onOpenLesson} /><Outline map={d.map as MMap} /></> : <p className="muted">This mind map could not be shown.</p>)}</Async>;
  return <Async s={own}>{d => <Inner key={lessonId} lessonId={lessonId} map={d.map as MMap} initial={d.state as State} subjectId={subjectId ?? d.subject_id} onOpenLesson={onOpenLesson} />}</Async>;
}
/** Text version of a map, for screen readers, small screens and when the drawing cannot be used. */
export function Outline({ map }: { map: MMap }) {
  const kids = (id: string | null) => map.nodes.filter(n => n.parent === id);
  const render = (id: string | null): any => <ul>{kids(id).map(n => <li key={n.id}><span lang="ta" className="ta">{n.ta}</span>{kids(n.id).length > 0 && render(n.id)}</li>)}</ul>;
  return <details className="mm-outline"><summary className="link">Text outline of this mind map</summary>{render(null)}</details>;
}

function Inner({ lessonId, map, initial, subjectId, onOpenLesson, local }: { local?: boolean; lessonId: string; map: MMap; initial: State; subjectId?: string; onOpenLesson: (a: { tab: 'explain' | 'examples'; el: string | null }) => void }) {
  const { lang, setLang } = useLang(); const toast = useToast();
  const [mode, setMode] = useState<Mode>(map.defaultMode); const [collapsed, setCollapsed] = useState<Set<string>>(() => (map.nodes.length > 45 && map.defaultMode !== 'simple' ? new Set(map.nodes.filter(n => n.parent === 'root' && map.nodes.some(c => c.parent === n.id)).map(n => n.id)) : new Set()));
  const [sel, setSel] = useState<string | null>(null); const [state, setState] = useState<State>(initial); const [query, setQuery] = useState(''); const [cursorMatch, setCursorMatch] = useState(0);
  const [tf, setTf] = useState({ x: 16, y: 16, k: 1 }); const [summary, setSummary] = useState(false); const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null); const svg = useRef<SVGSVGElement>(null); const by = useMemo(() => new Map(map.nodes.map(n => [n.id, n])), [map]);

  const matches = useMemo(() => { const t = query.trim().toLowerCase(); return t.length < 1 ? [] : map.nodes.filter(n => `${n.en} ${n.ta} ${n.detail_en ?? ''} ${n.detail_ta ?? ''}`.toLowerCase().includes(t)); }, [query, map]);
  const forced = useMemo(() => { const f = new Set<string>(); for (const m of matches) { let c: MNode | undefined = m; while (c) { f.add(c.id); c = c.parent ? by.get(c.parent) : undefined; } } return f; }, [matches, by]);
  const show = useMemo(() => { const s = modeShow(map, mode); forced.forEach(x => s.add(x)); return s; }, [map, mode, forced]);
  const eff = useMemo(() => { const c = new Set(collapsed); forced.forEach(x => c.delete(x)); return c; }, [collapsed, forced]);
  const lay = useMemo(() => layoutMap(map.nodes, show, eff, lang), [map, show, eff, lang]);
  const matchIds = useMemo(() => new Set(matches.map(m => m.id)), [matches]);

  const fit = useCallback((minK = 0.2) => { const el = box.current; if (!el) return; const cw = el.clientWidth, ch = el.clientHeight; const k = Math.max(minK, Math.min(cw / (lay.width + 32), ch / (lay.height + 32), 1.4)); setTf({ k, x: Math.max(16, (cw - lay.width * k) / 2), y: Math.max(16, (ch - lay.height * k) / 2) }); }, [lay.width, lay.height]);
  const reset = useCallback(() => { const el = box.current; if (!el) return; const k = Math.max(0.6, Math.min(1, (el.clientWidth) / (lay.width + 32))); const r = lay.boxes.get(lay.rootId)!; setTf({ k, x: 16, y: Math.max(16, el.clientHeight / 2 - (r.y + r.h / 2) * k) }); }, [lay]);
  useEffect(() => { reset(); }, [mode, map]); // eslint-disable-line
  const zoom = (f: number) => setTf(t => { const el = box.current!; const cx = el.clientWidth / 2, cy = el.clientHeight / 2; const k = Math.min(2.5, Math.max(0.2, t.k * f)); return { k, x: cx - (cx - t.x) * (k / t.k), y: cy - (cy - t.y) * (k / t.k) }; });
  const centerOn = useCallback((id: string) => { const b = lay.boxes.get(id), el = box.current; if (!b || !el) return; setTf(t => ({ ...t, x: el.clientWidth / 2 - (b.x + W / 2) * t.k, y: el.clientHeight / 2 - (b.y + b.h / 2) * t.k })); }, [lay]);

  // pan / pinch with pointer events
  const ptrs = useRef(new Map<number, { x: number; y: number }>()); const drag = useRef<{ sx: number; sy: number; tx: number; ty: number; moved: boolean } | null>(null); const pinch = useRef<{ d: number; k: number } | null>(null);
  const onDown = (e: React.PointerEvent) => { ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.current.size === 1) drag.current = { sx: e.clientX, sy: e.clientY, tx: tf.x, ty: tf.y, moved: false }; if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: tf.k }; drag.current = null; } };
  const onMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return; ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2 && pinch.current) { const [a, b] = [...ptrs.current.values()]; const k = Math.min(2.5, Math.max(0.2, pinch.current.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d)); setTf(t => ({ ...t, k })); return; }
    const d = drag.current; if (!d) return; const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 6) { d.moved = true; try { svg.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    if (d.moved) setTf(t => ({ ...t, x: d.tx + dx, y: d.ty + dy }));
  };
  const onUp = (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); if (ptrs.current.size < 2) pinch.current = null; if (!ptrs.current.size) setTimeout(() => { drag.current = null; }, 0); };
  const onWheel = (e: React.WheelEvent) => { if (!(e.ctrlKey || e.metaKey)) return; zoom(e.deltaY < 0 ? 1.1 : 0.9); };

  const select = (id: string) => { if (drag.current?.moved) return; setSel(id); };
  const toggle = (id: string) => setCollapsed(c => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allBranches = lay.list.filter(b => b.kids.length).map(b => b.n.id);
  const expandAll = () => setCollapsed(new Set()); const collapseAll = () => setCollapsed(new Set(allBranches.filter(i => i !== lay.rootId)));

  const save = async (next: State) => { if (local) { setState(next); return; } const prev = state; setState(next); setBusy(true); try { const r = await put(`/lessons/${lessonId}/mindmap/state`, next); setState({ understood: r.understood, revision: r.revision }); } catch (e) { setState(prev); toast(msg(e), 'err'); } finally { setBusy(false); } };
  const mark = (id: string, which: 'understood' | 'revision') => { const has = state[which].includes(id); const other = which === 'understood' ? 'revision' : 'understood';
    save({ ...state, [which]: has ? state[which].filter(x => x !== id) : [...state[which], id], [other]: state[other].filter(x => x !== id) } as State); };

  const node = sel ? by.get(sel) : null; const hiddenMatches = matches.filter(m => !modeShow(map, mode).has(m.id)).length;
  const branch = (() => { let c = node; while (c && c.parent && c.parent !== 'root') c = by.get(c.parent) ?? null; return c && c.parent === 'root' ? c : null; })();
  const askBranch = branch ? `/app/tutor?lesson=${lessonId}&q=${encodeURIComponent(`Ask me 3 practice questions, one at a time, about the branch "${branch.en}": ${(branch.detail_en ?? branch.en)}`.slice(0, 290))}` : null;
  const ask = (phrase: string, l?: 'ta' | 'en') => `/app/tutor?lesson=${lessonId}&q=${encodeURIComponent(`${phrase}: ${node ? (node.detail_en ?? node.en) : ''}`.slice(0, 290))}${l ? `&lang=${l}` : ''}`;

  const exportPng = async (print = false) => {
    try { await (document as any).fonts?.load('16px "Noto Sans Tamil"', 'தமிழ்'); await (document as any).fonts?.load('600 16px Inter'); } catch { /* fonts are best-effort */ }
    const sc = 2, pad = 28, head = 64, cw = lay.width + pad * 2, chh = lay.height + pad * 2 + head; const cv = document.createElement('canvas'); cv.width = cw * sc; cv.height = chh * sc; const g = cv.getContext('2d'); if (!g) { toast('Your browser cannot create the image.', 'err'); return; }
    g.scale(sc, sc); g.fillStyle = '#fff'; g.fillRect(0, 0, cw, chh); g.textBaseline = 'alphabetic';
    g.fillStyle = '#0b1f4d'; g.font = '700 20px Inter, "Noto Sans Tamil", sans-serif'; g.fillText(`${lang === 'ta' ? map.title_ta : map.title_en} — mind map`, pad, pad + 20);
    g.font = '12px Inter, "Noto Sans Tamil", sans-serif'; g.fillStyle = '#565b70'; g.fillText(`${MODES.find(m => m[0] === mode)![1]} mode · Karkai AI · ${map.source === 'lesson' ? 'Built from sample lesson content' : 'General map'}`, pad, pad + 40);
    const ox = pad, oy = pad + head;
    for (const b of lay.list) for (const k of b.kids) { if (eff.has(b.n.id)) continue; const c = lay.boxes.get(k)!; g.strokeStyle = c.color[1] === '#ffffff' ? '#0a3d91' : c.color[1]; g.lineWidth = 2; g.beginPath(); g.moveTo(ox + b.x + W, oy + b.y + b.h / 2); g.bezierCurveTo(ox + b.x + W + 30, oy + b.y + b.h / 2, ox + c.x - 30, oy + c.y + c.h / 2, ox + c.x, oy + c.y + c.h / 2); g.stroke(); }
    for (const b of lay.list) {
      const root = b.n.parent === null; g.fillStyle = b.color[0]; g.strokeStyle = root ? '#032862' : b.color[1]; g.lineWidth = state.understood.includes(b.n.id) ? 3 : 1.5; g.beginPath(); g.roundRect(ox + b.x, oy + b.y, W, b.h, 12); g.fill(); g.stroke();
      let y = oy + b.y + 18; g.fillStyle = root ? '#fff' : '#0b1f4d';
      if (KIND_LABEL[b.n.kind]) { g.font = '700 10px Inter, sans-serif'; g.fillStyle = root ? '#fff' : b.color[1]; g.fillText(KIND_LABEL[b.n.kind], ox + b.x + 12, y - 3); y += 14; g.fillStyle = '#0b1f4d'; }
      g.font = `${root || b.n.kind === 'branch' ? 700 : 500} ${FONT_EN}px Inter, sans-serif`; for (const l of b.enL) { g.fillText(l, ox + b.x + 12, y); y += 19; }
      g.font = `${FONT_TA}px "Noto Sans Tamil", Inter, sans-serif`; if (b.enL.length) y += 2; for (const l of b.taL) { g.fillText(l, ox + b.x + 12, y + 2); y += 22; }
    }
    if (print) { const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f); const d = f.contentDocument!; d.open(); d.write(`<!doctype html><title>Mind map</title><style>@page{size:landscape;margin:10mm}body{margin:0}img{width:100%}</style><img src="${cv.toDataURL('image/png')}">`); d.close(); const im = d.querySelector('img')!; const go = () => { f.contentWindow!.focus(); f.contentWindow!.print(); setTimeout(() => f.remove(), 2000); }; im.complete ? go() : (im.onload = go); return; }
    cv.toBlob(b => { if (!b) { toast('Could not create the image.', 'err'); return; } const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `mind-map-${lessonId}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Mind map image downloaded'); }, 'image/png');
  };

  const summaryItems = useMemo(() => {
    const marked = new Set(state.revision); const heads = map.nodes.filter(n => n.parent === 'root');
    return heads.map(h => { const sub = map.nodes.filter(n => n.parent === h.id && (n.rev || marked.has(n.id))); return { h, sub: sub.length ? sub : [] }; }).filter(x => x.sub.length || marked.has(x.h.id));
  }, [map, state]);

  return (
    <div className="col mm-root">
      <div className="notice info"><Icon name="info" /><div>{map.sourceNote}</div></div>
      <div className="mm-bar no-print">
        <div className="row wrap" role="group" aria-label="Mind map mode">{MODES.map(([k, t, d]) => <button key={k} className={`pill ${mode === k ? 'on' : ''}`} aria-pressed={mode === k} title={d} onClick={() => setMode(k)}>{t}</button>)}</div>
        <div className="lang mm-lang" role="group" aria-label="Mind map language">{([['ta', 'தமிழ்'], ['en', 'English'], ['both', 'தமிழ் + English']] as [Lang, string][]).map(([k, t]) => <button key={k} aria-pressed={lang === k} onClick={() => setLang(k)}><span className="lg">{t}</span><span className="sh">{k === 'both' ? 'த+EN' : k === 'ta' ? 'த' : 'EN'}</span></button>)}</div>
        <form className="mm-search" role="search" onSubmit={e => { e.preventDefault(); if (matches.length) { const i = (cursorMatch + 1) % matches.length; setCursorMatch(i); centerOn(matches[i].id); setSel(matches[i].id); } }}>
          <div className="field grow"><label className="sr" htmlFor="mm-q">Search this mind map</label><input id="mm-q" type="search" placeholder="Search concepts…" value={query} onChange={e => { setQuery(e.target.value); setCursorMatch(0); }} /></div>
          {query.trim() && <span className="muted small" aria-live="polite">{matches.length ? `${matches.length} found${hiddenMatches ? ` · ${hiddenMatches} not in this mode (shown)` : ''}` : 'No match'}</span>}
        </form>
      </div>
      <div className="mm-wrap">
        <div className="mm-main">
        <div className="mm-tools no-print" role="toolbar" aria-label="Map controls">
          <button className="btn secondary iconbtn" aria-label="Zoom in" onClick={() => zoom(1.25)}>+</button>
          <button className="btn secondary iconbtn" aria-label="Zoom out" onClick={() => zoom(0.8)}>−</button>
          <button className="btn secondary" onClick={() => fit()}>Fit</button>
          <button className="btn secondary" onClick={reset}>Reset</button>
          <button className="btn secondary" onClick={expandAll}>Expand all</button>
          <button className="btn secondary" onClick={collapseAll}>Collapse</button>
        </div>
        <div className="mm-canvas" ref={box}>
          <svg ref={svg} role="group" aria-label={`Mind map of ${map.title_en}`} width="100%" height="100%" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
            <g transform={`translate(${tf.x} ${tf.y}) scale(${tf.k})`}>
              {lay.list.map(b => eff.has(b.n.id) ? null : b.kids.map(k => { const c = lay.boxes.get(k)!; const x1 = b.x + W, y1 = b.y + b.h / 2, x2 = c.x, y2 = c.y + c.h / 2; return <path key={`${b.n.id}-${k}`} d={`M${x1} ${y1} C${x1 + 32} ${y1} ${x2 - 32} ${y2} ${x2} ${y2}`} fill="none" stroke={c.color[1] === '#ffffff' ? '#0a3d91' : c.color[1]} strokeWidth={2} opacity={0.7} />; }))}
              {lay.list.map(b => {
                const root = b.n.parent === null, isSel = sel === b.n.id, isMatch = matchIds.has(b.n.id), done = state.understood.includes(b.n.id), rv = state.revision.includes(b.n.id); const label = `${b.n.en}${lang !== 'en' ? ` / ${b.n.ta}` : ''}`;
                const y = 20 + (KIND_LABEL[b.n.kind] ? 14 : 0);
                return (
                  <g key={b.n.id} transform={`translate(${b.x} ${b.y})`}>
                    <g role="button" tabIndex={0} aria-label={`${label}${done ? ', understood' : ''}${rv ? ', marked for revision' : ''}`} aria-pressed={isSel} className="mm-node" onClick={() => select(b.n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(b.n.id); } }}>
                      <rect width={W} height={b.h} rx={12} fill={b.color[0]} stroke={isSel ? '#0b1f4d' : isMatch ? '#b8892b' : root ? '#032862' : b.color[1]} strokeWidth={isSel || isMatch ? 3.5 : b.n.kind === 'formula' ? 1.5 : 1.5} strokeDasharray={b.n.kind === 'formula' ? '5 3' : undefined} />
                      {KIND_LABEL[b.n.kind] && <text x={12} y={16} fontSize={10} fontWeight={700} fill={root ? '#fff' : b.color[1]} style={{ letterSpacing: '.06em' }}>{KIND_LABEL[b.n.kind]}</text>}
                      {b.enL.map((l, i) => <text key={`e${i}`} x={12} y={y + i * 19 - (KIND_LABEL[b.n.kind] ? 0 : 0)} fontSize={FONT_EN} fontWeight={root || b.n.kind === 'branch' ? 700 : 500} fill={root ? '#fff' : '#0b1f4d'}>{l}</text>)}
                      {b.taL.map((l, i) => <text key={`t${i}`} x={12} y={y + b.enL.length * 19 + (b.enL.length ? 2 : 0) + i * 22 + 1} fontSize={FONT_TA} fill={root ? '#fff' : '#0b1f4d'} style={{ fontFamily: 'var(--font-ta)' }}>{l}</text>)}
                      {done && <g><circle cx={W - 6} cy={6} r={10} fill="#15803d" stroke="#fff" strokeWidth={2} /><path d={`M${W - 11} 6 l4 4 l7 -8`} stroke="#fff" strokeWidth={2} fill="none" /></g>}
                      {rv && <g><circle cx={done ? W - 30 : W - 6} cy={6} r={10} fill="#b45309" stroke="#fff" strokeWidth={2} /><text x={done ? W - 30 : W - 6} y={10} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">!</text></g>}
                    </g>
                    {b.kids.length > 0 && <g role="button" tabIndex={0} aria-expanded={!eff.has(b.n.id)} aria-label={`${eff.has(b.n.id) ? 'Expand' : 'Collapse'} ${b.n.en}`} className="mm-toggle" transform={`translate(${W} ${b.h / 2})`} onClick={e => { e.stopPropagation(); toggle(b.n.id); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(b.n.id); } }}>
                      <circle r={12} fill="#fff" stroke={root ? '#0a3d91' : b.color[1]} strokeWidth={2} /><text textAnchor="middle" y={5} fontSize={14} fontWeight={700} fill={root ? '#0a3d91' : b.color[1]}>{eff.has(b.n.id) ? b.kids.length : '−'}</text></g>}
                  </g>);
              })}
            </g>
          </svg>
        </div>
        </div>
        <aside className="mm-panel" aria-live="polite" aria-label="Selected concept">
          {!node ? <div className="col"><h3>Pick a concept</h3><p className="muted small">Tap a box to read more and get help. Use the numbered circles to open or close a branch. Drag to move the map; pinch or use + / − to zoom.</p>
            <div className="mm-legend"><span><i style={{ background: '#0a3d91' }} />Topic</span><span><i style={{ background: '#d9f4f0', borderColor: '#0d9488' }} />Branch</span><span><i className="dash" />Formula</span><span><b className="ok">✓</b>Understood</span><span><b className="warn">!</b>Revise later</span></div></div>
          : <div className="col">
            <div className="row wrap"><Badge tone={node.kind === 'mistake' ? 'warning' : node.kind === 'definition' ? 'teal' : 'info'}>{KIND_LABEL[node.kind]?.toLowerCase() ?? (node.kind === 'topic' ? 'topic' : node.kind === 'branch' ? 'branch' : 'key point')}</Badge><button className="link" style={{ marginLeft: 'auto' }} onClick={() => setSel(null)} aria-label="Close details">Close</button></div>
            <h3>{lang !== 'ta' && node.en}{lang === 'both' && <br />}{lang !== 'en' && <span lang="ta" className="ta">{node.ta}</span>}</h3>
            {(node.detail_en || node.detail_ta) && <div className="col" style={{ gap: 6 }}>{lang !== 'ta' && <p>{node.detail_en ?? node.en}</p>}{lang !== 'en' && <p lang="ta" className="ta">{node.detail_ta ?? node.ta}</p>}</div>}
            <div className="row wrap"><Button tone={state.understood.includes(node.id) ? 'teal' : 'secondary'} disabled={busy} aria-pressed={state.understood.includes(node.id)} onClick={() => mark(node.id, 'understood')}>{state.understood.includes(node.id) ? '✓ Understood' : 'I understand this'}</Button>
              <Button tone="secondary" disabled={busy} aria-pressed={state.revision.includes(node.id)} onClick={() => mark(node.id, 'revision')}>{state.revision.includes(node.id) ? 'In my revision list' : 'Add to revision'}</Button></div>
            <div className="mm-actions" role="group" aria-label="Ask Karkai AI about this concept">
              <b className="small muted">Ask Karkai AI</b>
              <Link className="btn secondary" to={ask('Explain simply')}>Explain simply</Link>
              <Link className="btn secondary" to={ask('Explain in Tamil', 'ta')}>Explain in Tamil</Link>
              <Link className="btn secondary" to={ask('Explain in English', 'en')}>Explain in English</Link>
              <Link className="btn secondary" to={ask('Give an example of')}>Give an example</Link>
              <Link className="btn secondary" to={ask('Explain step by step')}>Step by step</Link>
              <Link className="btn secondary" to={ask('Ask me a practice question about')}>Practice question</Link>
              {askBranch && <Link className="btn secondary" to={askBranch}>Practise this branch</Link>}
            </div>
            <div className="row wrap"><Button tone="ghost" onClick={() => onOpenLesson(anchorFor(node.id))}>Open in lesson →</Button>{subjectId && <Button tone="ghost" to={`/app/practice?subject=${subjectId}`}>Practice this subject</Button>}</div>
          </div>}
        </aside>
      </div>
      <div className="row wrap no-print">
        <Button tone="secondary" onClick={() => exportPng(false)}>Download image (PNG)</Button>
        <Button tone="secondary" onClick={() => exportPng(true)}>Print / save as PDF</Button>
        <Button tone="secondary" onClick={() => setSummary(v => !v)} aria-expanded={summary}>{summary ? 'Hide' : 'Make'} revision summary</Button>
        <span className="muted small" aria-live="polite">{state.understood.length} understood · {state.revision.length} to revise · saved to your account</span>
      </div>
      {summary && <Card className="col"><h2>Revision summary</h2><p className="muted small">Key points from this lesson{state.revision.length ? ', plus the concepts you added to revision' : ''}. Built from the lesson content, not written by AI.</p>
        {summaryItems.map(({ h, sub }) => <div key={h.id}><b>{lang !== 'ta' && h.en}{lang === 'both' && ' · '}{lang !== 'en' && <span lang="ta" className="ta">{h.ta}</span>}</b><ul>{sub.map(n => <li key={n.id}>{lang !== 'ta' && (n.detail_en ?? n.en)}{lang === 'both' && <br />}{lang !== 'en' && <span lang="ta" className="ta">{n.detail_ta ?? n.ta}</span>}{state.revision.includes(n.id) && <> <Badge tone="warning">revise</Badge></>}</li>)}</ul></div>)}
      </Card>}
    </div>
  );
}

/** Quick Revision tab: the same validated map shown as a plain list (rev nodes only). */
export function RevisionList({ lessonId }: { lessonId: string }) {
  const { s } = useMindMap(lessonId); const { lang } = useLang();
  return <Async s={s}>{d => { const m = d.map as MMap; const st = d.state as State; const heads = m.nodes.filter(n => n.parent === 'root');
    return <div className="col"><div className="notice info"><Icon name="info" /><div>Key points only. {m.sourceNote}</div></div>
      {heads.map(h => { const sub = m.nodes.filter(n => n.parent === h.id && n.rev); if (!sub.length) return null; return <Card key={h.id} className="col"><h2>{lang !== 'ta' && h.en}{lang === 'both' && <br />}{lang !== 'en' && <span lang="ta" className="ta">{h.ta}</span>}</h2>
        <ul>{sub.map(n => <li key={n.id}>{lang !== 'ta' && <div>{n.detail_en ?? n.en}</div>}{lang !== 'en' && <div lang="ta" className="ta">{n.detail_ta ?? n.ta}</div>}{st.revision.includes(n.id) && <Badge tone="warning">in your revision list</Badge>}</li>)}</ul></Card>; })}</div>; }}</Async>;
}
