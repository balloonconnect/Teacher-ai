/** Browser-based voice helpers. Nothing is sent to our servers; support depends on the browser and installed voices. */
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;
export const canListen = !!SR;
export function speak(text: string, lang: 'ta' | 'en', rate = 1, onEnd?: () => void) {
  if (!canSpeak) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = lang === 'ta' ? 'ta-IN' : 'en-IN'; u.rate = rate;
  const v = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(lang === 'ta' ? 'ta' : 'en')); if (v) u.voice = v;
  u.onend = () => onEnd?.(); u.onerror = () => onEnd?.(); window.speechSynthesis.speak(u); return true;
}
export const stopSpeaking = () => canSpeak && window.speechSynthesis.cancel();
export function listen(lang: 'ta' | 'en', onResult: (t: string) => void, onEnd: (err?: string) => void) {
  if (!SR) return () => {};
  const r = new SR(); r.lang = lang === 'ta' ? 'ta-IN' : 'en-IN'; r.interimResults = false; r.maxAlternatives = 1;
  r.onresult = (e: any) => onResult(e.results[0][0].transcript); r.onerror = (e: any) => onEnd(e.error === 'not-allowed' ? 'Microphone permission was denied.' : 'Voice input did not work. You can type instead.'); r.onend = () => onEnd();
  try { r.start(); } catch { onEnd('Voice input did not work. You can type instead.'); }
  return () => { try { r.stop(); } catch { /* noop */ } };
}
