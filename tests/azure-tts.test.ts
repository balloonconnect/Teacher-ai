import { afterAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { azureTts, ttsFromEnv } from '../server/services/tts';

const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);
let seen: { url?: string; headers: http.IncomingHttpHeaders; body: string }[] = []; let status = 200;
const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { seen.push({ url: req.url, headers: req.headers, body: b }); res.statusCode = status; if (status === 200) res.setHeader('content-type', 'audio/mpeg'); res.end(status === 200 ? MP3 : 'denied'); }); });
await new Promise<void>(r => srv.listen(0, r)); const endpoint = `http://127.0.0.1:${(srv.address() as any).port}/cognitiveservices/v1`;
afterAll(() => { srv.closeAllConnections?.(); srv.close(); });
const sig = () => new AbortController().signal;

describe('Azure AI Speech provider (against a mock of the REST API)', () => {
  it('posts SSML with the subscription key, picks the Tamil / English voice, and escapes the text', async () => {
    seen = []; status = 200; const p = azureTts({ key: 'azkey', endpoint });
    const ta = await p.synth('வணக்கம் <b>&</b>', 'ta', sig()); expect(ta.mime).toBe('audio/mpeg'); expect(ta.audio.equals(MP3)).toBe(true);
    const r = seen[0]; expect(r.headers['ocp-apim-subscription-key']).toBe('azkey'); expect(r.headers['content-type']).toBe('application/ssml+xml'); expect(r.headers['x-microsoft-outputformat']).toMatch(/mp3/);
    expect(r.body).toContain('name="ta-IN-PallaviNeural"'); expect(r.body).toContain('xml:lang="ta-IN"'); expect(r.body).toContain('வணக்கம் &lt;b&gt;&amp;&lt;/b&gt;'); expect(r.body).not.toContain('<b>');
    await p.synth('Hello', 'en', sig()); expect(seen[1].body).toContain('name="en-IN-NeerjaNeural"'); expect(seen[1].body).toContain('xml:lang="en-IN"');
  });
  it('uses the regional endpoint by default and custom voices when configured', async () => {
    seen = []; const p = azureTts({ key: 'k', endpoint, voiceTa: 'ta-IN-ValluvarNeural' }); await p.synth('x', 'ta', sig()); expect(seen[0].body).toContain('ta-IN-ValluvarNeural');
    const env = ttsFromEnv({ AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'centralindia' } as any); expect(env?.name).toBe('azure-speech');
    expect(ttsFromEnv({ AZURE_SPEECH_KEY: 'k' } as any)).toBeNull(); // a key without a region is not a configuration
  });
  it('reports a rejected key as a clear error without leaking the key', async () => {
    status = 401; const p = azureTts({ key: 'topsecret', endpoint }); const e: any = await p.synth('x', 'en', sig()).catch(x => x);
    expect(e.name).toBe('TtsError'); expect(e.message).toMatch(/error \(401\)/); expect(e.message).not.toContain('topsecret'); status = 200;
  });
});
