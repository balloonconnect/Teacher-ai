/** Local speech-to-text through any OpenAI-style Whisper server (faster-whisper-server, whisper.cpp server, LocalAI…). Audio never leaves the machine you point STT_URL at. */
export interface SttProvider { name: string; transcribe(audio: Buffer, mime: string, lang: 'ta' | 'en' | 'auto', signal?: AbortSignal): Promise<{ text: string }> }
export class SttError extends Error { constructor(public status: number, m: string) { super(m); } }

const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a' };
export const sttMime = (ct: string) => (ct.split(';')[0].trim().toLowerCase());
export const sttAllowed = (ct: string) => sttMime(ct) in EXT;

export function sttClient(o: { url: string; model?: string; apiKey?: string; timeoutMs?: number }, f: typeof fetch = fetch): SttProvider {
  const base = o.url.replace(/\/+$/, ''); const endpoint = /\/audio\/transcriptions$/.test(base) ? base : `${base}/v1/audio/transcriptions`;
  return {
    name: `whisper:${o.model ?? 'base'}`,
    async transcribe(audio, mime, lang, signal) {
      const fd = new FormData(); fd.append('file', new Blob([new Uint8Array(audio)], { type: sttMime(mime) }), `speech.${EXT[sttMime(mime)] ?? 'webm'}`);
      fd.append('model', o.model ?? 'base'); fd.append('response_format', 'json'); if (lang !== 'auto') fd.append('language', lang);
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), o.timeoutMs ?? 60000); signal?.addEventListener('abort', () => ac.abort());
      try {
        const r = await f(endpoint, { method: 'POST', body: fd, headers: o.apiKey ? { Authorization: `Bearer ${o.apiKey}` } : undefined, signal: ac.signal });
        if (!r.ok) throw new SttError(502, 'The speech service could not read that recording.');
        const j: any = await r.json(); return { text: String(j.text ?? '').trim() };
      } catch (e: any) {
        if (e instanceof SttError) throw e; if (signal?.aborted) throw new SttError(499, 'Stopped.');
        throw new SttError(e?.name === 'AbortError' ? 504 : 502, e?.name === 'AbortError' ? 'The speech service took too long.' : 'The speech service is not running.');
      } finally { clearTimeout(t); }
    },
  };
}
export const sttFromEnv = (env = process.env): SttProvider | null => (env.STT_URL ? sttClient({ url: env.STT_URL, model: env.STT_MODEL, apiKey: env.STT_API_KEY }) : null);
