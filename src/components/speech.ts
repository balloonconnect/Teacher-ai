/** Browser speech helpers for the voice tutor. Recognition and synthesis run on the student's device; no audio is sent to our servers. */
export type SpeechLang = 'ta' | 'en';
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;
export const canListen = !!SR;
export const hasVoice = (l: SpeechLang) => { if (!canSpeak) return false; const v = window.speechSynthesis.getVoices(); return !v.length || v.some(x => x.lang.toLowerCase().startsWith(l)); };

export type Seg = { id: string; text: string; lang: SpeechLang };
/** Speaks segments one after another. Supports pause, resume, mute, slower speech and instant interruption. */
export class Speaker {
  private q: Seg[] = []; private busy = false; private gen = 0; rate = 1; muted = false;
  onStart?: (id: string) => void; onIdle?: () => void; onFirstAudio?: () => void; onError?: (why: string, retry?: () => void) => void; onReplayMs?: (ms: number, fromCache: boolean) => void; readonly kind = 'browser' as const; private first = true; private replayT0 = 0; private paused = false;
  get speaking() { return this.busy || this.q.length > 0; }
  reset() { this.first = true; }
  enqueue(segs: Seg[]) { if (this.muted || !canSpeak) { segs.forEach(s => this.onStart?.(s.id)); return; } this.q.push(...segs); if (!this.busy) this.next(); }
  private next() {
    const seg = this.q.shift(); if (!seg) { this.busy = false; this.onIdle?.(); return; }
    this.busy = true; const g = this.gen; const u = new SpeechSynthesisUtterance(seg.text); u.lang = seg.lang === 'ta' ? 'ta-IN' : 'en-IN'; u.rate = this.rate;
    const v = window.speechSynthesis.getVoices().find(x => x.lang.toLowerCase().startsWith(seg.lang)); if (v) u.voice = v;
    let started = false; const dog = setTimeout(() => { if (!started && g === this.gen) { this.onError?.('Speech did not start on this device. The text is still shown.'); this.busy = false; this.q = []; this.onIdle?.(); } }, 5000);
    u.onstart = () => { started = true; clearTimeout(dog); if (g !== this.gen) return; this.onStart?.(seg.id); if (this.replayT0) { const ms = Math.round(performance.now() - this.replayT0); this.replayT0 = 0; this.onReplayMs?.(ms, false); } if (this.first) { this.first = false; this.onFirstAudio?.(); } };
    const end = () => { clearTimeout(dog); if (g !== this.gen) return; this.next(); };
    u.onend = end; u.onerror = e => { clearTimeout(dog); if (g !== this.gen) return; if ((e as any).error && (e as any).error !== 'interrupted' && (e as any).error !== 'canceled') this.onError?.('Speech could not be played. The text is still shown.'); this.next(); };
    window.speechSynthesis.speak(u);
  }
  /** Stops now and forgets everything queued (used when the student interrupts). */
  cancel() { this.gen++; this.q = []; this.busy = false; this.replayT0 = 0; if (canSpeak) window.speechSynthesis.cancel(); }
  /** Skips the sentence being spoken and carries on with the queue. */
  skip() { this.gen++; this.busy = false; if (canSpeak) window.speechSynthesis.cancel(); this.next(); }
  /** Speaks these segments now, before whatever is still queued. The browser cannot keep its own audio, so this re-speaks locally (no language model, no network). */
  replay(segs: Seg[]) { if (this.muted || !canSpeak) { segs.forEach(s => this.onStart?.(s.id)); return; } this.gen++; this.busy = false; if (canSpeak) window.speechSynthesis.cancel(); this.replayT0 = performance.now(); this.q = [...segs, ...this.q]; this.next(); }
  release() { this.cancel(); }
  pause() { if (canSpeak) window.speechSynthesis.pause(); } resume() { if (canSpeak) window.speechSynthesis.resume(); }
}

export type Recognizer = { stop: () => void };
export function recognize(o: { lang: SpeechLang; onInterim: (t: string) => void; onFinal: (t: string, ms: number) => void; onSpeechStart: () => void; onError: (code: string) => void; onEnd: () => void }): Recognizer | null {
  if (!SR) return null; const r = new SR(); r.lang = o.lang === 'ta' ? 'ta-IN' : 'en-IN'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1; let t0 = 0;
  r.onspeechstart = () => { t0 = performance.now(); o.onSpeechStart(); };
  r.onresult = (e: any) => { const res = e.results[e.results.length - 1]; const txt = String(res[0].transcript).trim(); if (!t0) { t0 = performance.now(); o.onSpeechStart(); } if (res.isFinal) o.onFinal(txt, Math.round(performance.now() - t0)); else o.onInterim(txt); };
  r.onerror = (e: any) => o.onError(String(e.error)); r.onend = () => o.onEnd();
  try { r.start(); } catch { o.onError('start-failed'); return null; }
  return { stop: () => { try { r.stop(); } catch { /* noop */ } } };
}
