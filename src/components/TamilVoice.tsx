import { useCallback, useEffect, useRef, useState } from 'react';
import { chunkText, normalizeTamil } from '../../shared/tamil';
import { get, getCsrf } from '../api';

/**
 * "Listen in Tamil". Reads the given text aloud in Tamil, piece by piece, so long passages are never cut off.
 * Two engines, never an unrelated language: the server's AI Tamil voice (when the admin configured one) and the browser's own
 * ta-IN voices. If neither exists the player says so instead of reading Tamil with an English voice.
 * Nothing plays until the user presses the button; changing the text stops playback and discards prepared audio.
 */
type State = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
type Cfg = { enabled: boolean; provider: string | null } | null;
let cfgPromise: Promise<Cfg> | null = null;
const loadCfg = (): Promise<Cfg> => (cfgPromise ??= get('/tamil/config').then(c => c.tts as Cfg).catch(() => null));
export const SPEEDS = [0.75, 1, 1.25, 1.5];
const synthOK = typeof window !== 'undefined' && 'speechSynthesis' in window;
const isTa = (v: SpeechSynthesisVoice) => /^ta([-_]|$)/i.test(v.lang);

export function TamilVoice({ text, label = 'Listen in Tamil', onChunk, chunkMax }: { text: string; label?: string; onChunk?: (chunk: string | null) => void; chunkMax?: number }) {
  const cb = useRef(onChunk); cb.current = onChunk; // tells the page which piece is being read now, so it can highlight it
  const [cfg, setCfg] = useState<Cfg>(null); const [cfgDone, setCfgDone] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]); const [voiceId, setVoiceId] = useState('');
  const [speed, setSpeed] = useState(1); const [state, setState] = useState<State>('idle'); const [err, setErr] = useState(''); const [pct, setPct] = useState(0); const [part, setPart] = useState<[number, number]>([0, 0]);
  const run = useRef(0); const audio = useRef<HTMLAudioElement | null>(null); const urls = useRef<Map<number, Promise<string>>>(new Map()); const speedRef = useRef(1); speedRef.current = speed;

  useEffect(() => { let on = true; loadCfg().then(c => { if (on) { setCfg(c); setCfgDone(true); } }); return () => { on = false; }; }, []);
  useEffect(() => {
    if (!synthOK) return; const read = () => setVoices(window.speechSynthesis.getVoices().filter(isTa));
    read(); window.speechSynthesis.addEventListener?.('voiceschanged', read); return () => window.speechSynthesis.removeEventListener?.('voiceschanged', read);
  }, []);
  const options = [...(cfg?.enabled ? [{ id: 'server', name: 'AI Tamil voice' }] : []), ...voices.map(v => ({ id: `b:${v.voiceURI}`, name: v.name }))];
  useEffect(() => { if (!options.some(o => o.id === voiceId)) setVoiceId(options[0]?.id ?? ''); }, [options.map(o => o.id).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const release = useCallback(() => {
    run.current++; if (synthOK) window.speechSynthesis.cancel();
    if (audio.current) { audio.current.onended = audio.current.onerror = audio.current.ontimeupdate = null; audio.current.pause(); audio.current = null; }
    urls.current.forEach(p => p.then(u => URL.revokeObjectURL(u)).catch(() => {})); urls.current.clear();
  }, []);
  const stop = useCallback(() => { release(); cb.current?.(null); setState('idle'); setPct(0); setPart([0, 0]); }, [release]);
  useEffect(() => { stop(); setErr(''); }, [text, stop]); // editing the text invalidates any prepared audio
  useEffect(() => () => release(), [release]);

  const fetchChunk = (chunk: string, i: number): Promise<string> => {
    let p = urls.current.get(i); if (p) return p;
    p = fetch('/api/tamil/tts', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() }, credentials: 'same-origin', body: JSON.stringify({ text: chunk }) })
      .then(async r => { if (!r.ok) { let m = 'The Tamil voice service could not make audio right now.'; try { m = (await r.json()).error ?? m; } catch { /* keep default */ } throw new Error(m); } return URL.createObjectURL(await r.blob()); });
    urls.current.set(i, p); return p;
  };

  const play = async () => {
    const clean = normalizeTamil(text); if (!clean) { setErr('There is no text to read.'); setState('error'); return; }
    if (!voiceId) { setErr('No Tamil voice is available on this device or server.'); setState('error'); return; }
    release(); const my = ++run.current; setErr(''); const server = voiceId === 'server'; const chunks = chunkText(clean, chunkMax ?? (server ? 280 : 180)); setPart([0, chunks.length]); setPct(0);
    const alive = () => run.current === my;
    const fail = (m: string) => { if (alive()) { cb.current?.(null); setErr(m); setState('error'); } };
    const next = (i: number) => {
      if (!alive()) return; if (i >= chunks.length) { cb.current?.(null); setState('idle'); setPct(100); return; }
      cb.current?.(chunks[i]); setPart([i, chunks.length]); setPct(Math.round((i / chunks.length) * 100));
      if (server) {
        setState(s => (s === 'paused' ? s : 'loading'));
        fetchChunk(chunks[i], i).then(u => {
          if (!alive()) return; if (i + 1 < chunks.length) fetchChunk(chunks[i + 1], i + 1).catch(() => {});
          const a = new Audio(u); a.playbackRate = speedRef.current; audio.current = a;
          a.ontimeupdate = () => { if (alive() && a.duration) setPct(Math.round(((i + a.currentTime / a.duration) / chunks.length) * 100)); };
          a.onended = () => next(i + 1); a.onerror = () => fail('The audio could not be played.');
          a.play().then(() => alive() && setState('playing')).catch(() => fail('Your browser blocked the audio. Press Listen again.'));
        }).catch(e => fail(e.message));
      } else {
        const v = voices.find(x => `b:${x.voiceURI}` === voiceId); const u = new SpeechSynthesisUtterance(chunks[i]);
        if (v) u.voice = v; u.lang = v?.lang || 'ta-IN'; u.rate = speedRef.current;
        u.onstart = () => alive() && setState('playing'); u.onend = () => next(i + 1);
        u.onerror = e => { if (e.error !== 'canceled' && e.error !== 'interrupted') fail('Your device could not speak this text in Tamil.'); };
        window.speechSynthesis.speak(u);
      }
    };
    setState('loading'); next(0);
  };
  const pause = () => { if (voiceId === 'server') audio.current?.pause(); else window.speechSynthesis.pause(); setState('paused'); };
  const resume = () => { if (voiceId === 'server') audio.current?.play().catch(() => {}); else window.speechSynthesis.resume(); setState('playing'); };
  const changeSpeed = (v: number) => { setSpeed(v); if (audio.current) audio.current.playbackRate = v; };

  const noVoice = cfgDone && !options.length;
  const busy = state === 'playing' || state === 'paused' || state === 'loading';
  return (
    <div className="tvoice col" role="group" aria-label="Tamil voice">
      <div className="row wrap">
        {!busy && <button type="button" className="btn" onClick={play} disabled={noVoice || !text.trim()}><span aria-hidden="true">▶ </span>{label}</button>}
        {state === 'playing' && <button type="button" className="btn secondary" onClick={pause} aria-label="Pause"><span aria-hidden="true">⏸ </span>Pause</button>}
        {state === 'paused' && <button type="button" className="btn" onClick={resume} aria-label="Resume"><span aria-hidden="true">▶ </span>Resume</button>}
        {busy && <button type="button" className="btn secondary" onClick={stop} aria-label="Stop"><span aria-hidden="true">⏹ </span>Stop</button>}
        <label className="sr" htmlFor="tv-speed">Speech speed</label>
        <select id="tv-speed" value={speed} onChange={e => changeSpeed(Number(e.target.value))} aria-label="Speech speed">{SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}</select>
        {options.length > 1 && <><label className="sr" htmlFor="tv-voice">Tamil voice</label><select id="tv-voice" value={voiceId} onChange={e => { stop(); setVoiceId(e.target.value); }} aria-label="Tamil voice">{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></>}
      </div>
      {busy && <div className="row" style={{ gap: 8 }}><div className="bar" role="progressbar" aria-label="Playback progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ flex: 1 }}><i style={{ width: `${pct}%` }} /></div><span className="muted small">{part[1] ? `${Math.min(part[0] + 1, part[1])}/${part[1]}` : ''}</span></div>}
      <div role="status" aria-live="polite" className="small">
        {state === 'loading' && <span className="muted">Preparing the Tamil voice…</span>}
        {noVoice && <span className="muted">This device has no Tamil voice, and no AI Tamil voice is set up on the server. Install a Tamil voice in your device’s speech settings, or ask your school admin to set one up.</span>}
        {state === 'error' && err && <span className="err" style={{ color: 'var(--danger)' }}>{err}</span>}
      </div>
    </div>
  );
}
