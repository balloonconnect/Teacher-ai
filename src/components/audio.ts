import { AudioCache, splitSpoken } from '../../shared/audioCache';
import type { Seg, SpeechLang } from './speech';

export type Fetcher = (text: string, lang: SpeechLang, signal: AbortSignal) => Promise<Blob>;
type Part = { id: string; idx: number; text: string; lang: SpeechLang; key: string };
/**
 * Plays server-generated (AI) voice. Every sentence is fetched once, kept in an in-memory cache and replayed from there:
 * Replay never calls the language model and never asks for new audio while the cache still holds it.
 * Same surface as the browser `Speaker`, so the page can use either.
 */
export class CloudSpeaker {
  readonly kind = 'cloud' as const; muted = false; onStart?: (id: string) => void; onIdle?: () => void; onFirstAudio?: () => void; onError?: (why: string, retry?: () => void) => void; onReplayMs?: (ms: number, fromCache: boolean) => void;
  readonly cache: AudioCache; sessionId = ''; fetches = 0;
  private q: Part[] = []; private busy = false; private gen = 0; private first = true; private paused = false; private _rate = 1; private audio = new Audio(); private inflight = new Map<string, Promise<string | null>>();
  private replayT0 = 0; private replayCached = false;
  constructor(private fetcher: Fetcher, cacheMb = 24, private timeoutMs = 15000) { this.cache = new AudioCache(cacheMb * 1024 * 1024); this.audio.preload = 'auto'; }
  get rate() { return this._rate; } set rate(v: number) { this._rate = v; this.audio.playbackRate = v; }
  get speaking() { return this.busy || this.q.length > 0; }
  reset() { this.first = true; }
  private parts(segs: Seg[]): Part[] { return segs.flatMap(s => splitSpoken(s.text).map((t, i) => ({ id: s.id, idx: i, text: t, lang: s.lang, key: AudioCache.key(this.sessionId, s.id, i, s.lang) }))); }
  private prefetch(p: Part): Promise<string | null> {
    const hit = this.cache.get(p.key); if (hit) return Promise.resolve(hit);
    const run = this.inflight.get(p.key); if (run) return run;
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), this.timeoutMs); this.fetches++;
    const pr = this.fetcher(p.text, p.lang, ac.signal).then(b => this.cache.set(p.key, b), () => null).finally(() => { clearTimeout(t); this.inflight.delete(p.key); });
    this.inflight.set(p.key, pr); return pr;
  }
  enqueue(segs: Seg[]) { if (this.muted) { segs.forEach(s => this.onStart?.(s.id)); return; } const ps = this.parts(segs); this.q.push(...ps); ps.forEach(p => void this.prefetch(p)); if (!this.busy) void this.next(); }
  private async next() {
    const g = this.gen; const p = this.q.shift(); if (!p) { this.busy = false; this.onIdle?.(); return; }
    this.busy = true; const url = await this.prefetch(p); if (g !== this.gen) return;
    if (!url) { this.onError?.('The voice for this part could not be made. The text is still shown.', () => this.replay([{ id: p.id, text: p.text, lang: p.lang }])); void this.next(); return; }
    const a = this.audio; a.onplaying = null; a.onended = null; a.onerror = null; a.src = url; a.playbackRate = this._rate;
    a.onplaying = () => { if (g !== this.gen) return; this.onStart?.(p.id); if (this.first) { this.first = false; this.onFirstAudio?.(); } if (this.replayT0) { const ms = Math.round(performance.now() - this.replayT0); this.replayT0 = 0; this.onReplayMs?.(ms, this.replayCached); } };
    a.onended = () => { if (g === this.gen) void this.next(); };
    a.onerror = () => { if (g !== this.gen) return; this.cache.delete(p.key); this.onError?.('This audio could not be played. The text is still shown.', () => this.replay([{ id: p.id, text: p.text, lang: p.lang }])); void this.next(); };
    if (this.paused) return; a.play().catch(e => { if (g !== this.gen) return; this.onError?.(e?.name === 'NotAllowedError' ? 'Your browser blocked audio. Press Replay to play it.' : 'Audio could not start. The text is still shown.', () => this.replay([{ id: p.id, text: p.text, lang: p.lang }])); void this.next(); });
  }
  /** Stops everything, including anything still queued (used when the student interrupts). */
  cancel() { this.gen++; this.q = []; this.busy = false; this.paused = false; this.replayT0 = 0; this.audio.pause(); }
  /** Skips the sentence being spoken and carries on with the queue. */
  skip() { this.gen++; this.audio.pause(); this.busy = false; void this.next(); }
  /** Plays these segments now, before whatever is still queued. Uses cached audio; never touches the language model. */
  replay(segs: Seg[]) { this.gen++; this.audio.pause(); this.paused = false; this.busy = false; const ps = this.parts(segs); this.replayCached = ps.every(p => this.cache.has(p.key)); this.replayT0 = performance.now(); this.q = [...ps, ...this.q]; ps.forEach(p => void this.prefetch(p)); void this.next(); }
  pause() { this.paused = true; this.audio.pause(); } resume() { this.paused = false; if (this.audio.src && this.busy) void this.audio.play().catch(() => {}); }
  /** Frees every cached clip (call when the conversation ends). */
  release() { this.cancel(); this.cache.clear(); this.audio.removeAttribute('src'); }
}
