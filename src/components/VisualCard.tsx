import { useEffect, useRef, useState } from 'react';
import { keyQuery, renderSvg, svgDataUri, Lng, Visual } from '../../shared/visuals';
import { PREVIEW } from '../preview';

const srcOf = (v: Visual, lng: Lng) => PREVIEW ? svgDataUri(renderSvg(v.key, lng) ?? '') : `/api/visuals/svg/${v.key.id}?${keyQuery(v.key, lng)}`;

/** One teaching diagram: title, caption, source, zoom / full screen, hide / show, and follow-up questions. Failure only hides the picture. */
export function VisualCard({ v, lng, onAsk, canSimple }: { v: Visual; lng: Lng; onAsk: (t: string) => void; canSimple: boolean }) {
  const [hidden, setHidden] = useState(false); const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading'); const [big, setBig] = useState(false); const [zoom, setZoom] = useState(1);
  const dlg = useRef<HTMLDialogElement>(null); const src = srcOf(v, lng); const ta = lng === 'ta'; const alt = ta ? v.alt.ta : v.alt.en; const title = ta ? v.title.ta : v.title.en; const cap = ta ? v.caption.ta : v.caption.en;
  useEffect(() => { setState('loading'); }, [src]);
  useEffect(() => { const d = dlg.current; if (!d) return; if (big && !d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } } if (!big && d.open) d.close(); }, [big]);
  if (hidden) return <div className="vt-vis hidden"><button className="pill" onClick={() => setHidden(false)}>Show diagram: {title}</button></div>;
  return (
    <figure className="vt-vis" aria-label={title}>
      <figcaption className="vt-vis-h"><b>{title}</b>{!v.reviewed && <span className="vt-vis-tag" title="This diagram is drawn by the app and has not yet been checked by a teacher.">Not yet teacher-reviewed</span>}</figcaption>
      <div className="vt-vis-box">
        {state === 'loading' && <div className="vt-vis-skel" aria-hidden="true" />}
        {state === 'error'
          ? <div className="notice warn" role="status">The picture could not be loaded. The lesson continues in text and voice. <button className="link" onClick={() => setState('loading')}>Try again</button></div>
          : <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={() => setState('ok')} onError={() => setState('error')} style={state === 'loading' ? { visibility: 'hidden', position: 'absolute' } : undefined} />}
      </div>
      <p className="small muted vt-vis-cap">{cap}</p>
      <p className="small muted vt-vis-src">Source: {v.source} · Licence: {v.license}</p>
      <div className="chips">
        <button className="pill" onClick={() => { setZoom(1); setBig(true); }} disabled={state !== 'ok'}>View larger</button>
        <button className="pill" onClick={() => setHidden(true)}>Hide image</button>
        <button className="pill" onClick={() => onAsk('Explain this diagram')}>Explain this diagram</button>
        {canSimple && v.key.lvl !== 'simple' && <button className="pill" onClick={() => onAsk('Show a simpler diagram')}>Simpler diagram</button>}
        {v.labels.length > 0 && <button className="pill" onClick={() => onAsk('What do the labels mean?')}>What do the labels mean?</button>}
      </div>
      <dialog ref={dlg} className="vt-dlg" onClose={() => setBig(false)} aria-label={title}>
        <div className="vt-dlg-bar"><b>{title}</b>
          <span className="row"><button className="pill" onClick={() => setZoom(z => Math.max(1, +(z - 0.5).toFixed(1)))} aria-label="Zoom out">−</button><span className="small" aria-live="polite">{Math.round(zoom * 100)}%</span><button className="pill" onClick={() => setZoom(z => Math.min(4, +(z + 0.5).toFixed(1)))} aria-label="Zoom in">+</button><button className="pill" onClick={() => setBig(false)}>Close</button></span></div>
        <div className="vt-dlg-body"><img src={src} alt={alt} style={{ width: `${zoom * 100}%` }} /></div>
      </dialog>
    </figure>
  );
}
