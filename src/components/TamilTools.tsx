import { useEffect, useState } from 'react';
import { get, post, msg } from '../api';
import { normalizeTamil } from '../../shared/tamil';
import { TamilVoice } from './TamilVoice';

const hasTamil = (s: string) => /[஀-௿]/.test(s);
const ACTIONS: [string, string][] = [['correct', 'Correct Tamil grammar'], ['simplify', 'Simplify Tamil'], ['formal', 'Rewrite in formal Tamil'], ['conversational', 'Rewrite in conversational Tamil'], ['to_english', 'Translate into English']];

/** The text, with listen / copy / edit / language actions. The original is always kept so any change can be compared and undone. */
export function TamilTools({ text }: { text: string }) {
  const [original, setOriginal] = useState(() => normalizeTamil(text)); const [cur, setCur] = useState(original);
  const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(''); const [note, setNote] = useState(''); const [bad, setBad] = useState(false); const [llm, setLlm] = useState<boolean | null>(null); const [showOrig, setShowOrig] = useState(false);
  useEffect(() => { const t = normalizeTamil(text); setOriginal(t); setCur(t); setNote(''); setEditing(false); }, [text]);
  useEffect(() => { let on = true; get('/tamil/config').then(c => on && setLlm(!!c.llm?.enabled)).catch(() => on && setLlm(false)); return () => { on = false; }; }, []);
  const changed = cur !== original;
  const copy = async () => { try { await navigator.clipboard.writeText(cur); setBad(false); setNote('Copied.'); } catch { setBad(true); setNote('Your browser did not allow copying. Select the text and copy it.'); } };
  const act = async (action: string) => {
    setBusy(action); setNote(''); setBad(false);
    try { const r = await post('/tamil/transform', { action, text: cur }); if (!r.changed) setNote('Nothing needed to change.'); else { setCur(r.text); setNote('Done. Your original text is kept: you can compare or restore it.'); } }
    catch (e) { setBad(true); setNote(msg(e)); } finally { setBusy(''); }
  };
  const tamil = hasTamil(cur);
  return (
    <div className="col tamil-tools">
      {editing
        ? <textarea className="tamil-text" lang="ta" rows={Math.min(14, Math.max(4, cur.split('\n').length + 2))} value={cur} onChange={e => setCur(e.target.value)} aria-label="Edit Tamil text" style={{ width: '100%' }} />
        : <p className="tamil-text" lang={tamil ? 'ta' : 'en'}>{cur}</p>}
      <div className="row wrap">
        <button type="button" className="btn secondary" onClick={copy}>Copy Tamil text</button>
        <button type="button" className="btn secondary" onClick={() => setEditing(e => { if (e) setCur(normalizeTamil(cur)); return !e; })}>{editing ? 'Done editing' : 'Edit Tamil text'}</button>
        {changed && <button type="button" className="btn secondary" onClick={() => { setCur(original); setNote('Original restored.'); setBad(false); }}>Restore original</button>}
        {changed && <button type="button" className="btn secondary" onClick={() => setShowOrig(s => !s)} aria-pressed={showOrig}>{showOrig ? 'Hide original' : 'Compare with original'}</button>}
      </div>
      {llm && <div className="row wrap" aria-label="Language actions">
        {(tamil ? ACTIONS : [['to_tamil', 'Translate into Tamil']] as [string, string][]).map(([k, label]) => <button key={k} type="button" className="btn secondary" disabled={!!busy || editing || !cur.trim()} onClick={() => act(k)}>{busy === k ? 'Working…' : label}</button>)}
      </div>}
      {llm === false && <p className="muted small">Correct, simplify and translate need an AI model, which is not set up on this server yet. Copy, edit and listen still work.</p>}
      {showOrig && changed && <div className="card col"><b className="small">Original</b><p className="tamil-text" lang="ta">{original}</p></div>}
      <div role="status" aria-live="polite" className={`small ${bad ? 'err' : 'muted'}`} style={bad ? { color: 'var(--danger)' } : undefined}>{note}</div>
      {tamil && <TamilVoice text={cur} />}
    </div>
  );
}
