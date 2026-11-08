import { describe, it, expect } from 'vitest';
import { ollamaClient, ollamaHealth, llmClientFromEnv } from '../server/services/llmEngine';

const nd = (...o: object[]) => new Response(new ReadableStream({ start(c) { for (const x of o) c.enqueue(new TextEncoder().encode(JSON.stringify(x) + '\n')); c.close(); } }), { headers: { 'content-type': 'application/x-ndjson' } });
const args = (s = new AbortController().signal) => ({ system: 's', user: 'u', maxTokens: 50, signal: s });

describe('Ollama provider', () => {
  it('is chosen by LLM_PROVIDER=ollama and by LOCAL_ONLY, and LOCAL_ONLY refuses hosted providers', () => {
    expect(llmClientFromEnv({ LLM_PROVIDER: 'ollama', OLLAMA_MODEL: 'gemma3:4b' } as any)?.name).toBe('ollama:gemma3:4b');
    expect(llmClientFromEnv({ LOCAL_ONLY: '1', ANTHROPIC_API_KEY: 'x' } as any)?.name).toBe('ollama:qwen3:4b');
    expect(llmClientFromEnv({ LOCAL_ONLY: '1', LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'x' } as any)).toBeNull();
    expect(llmClientFromEnv({} as any)).toBeNull();
  });
  it('streams text, hides <think> blocks and only sends think:false to models that think', async () => {
    const seen: any[] = []; const real = globalThis.fetch;
    globalThis.fetch = (async (_u: any, init: any) => { seen.push(JSON.parse(init.body)); return nd({ message: { content: '<thi' } }, { message: { content: 'nk>secret</think>Hello ' } }, { message: { content: 'there' } }, { done: true, prompt_eval_count: 5, eval_count: 2 }); }) as any;
    try {
      const q = ollamaClient({ baseUrl: 'http://x', model: 'qwen3:4b' }); let out = ''; for await (const t of q.stream!(args())) out += t;
      expect(out).toBe('Hello there'); expect(seen[0].think).toBe(false); expect(seen[0].options.num_predict).toBe(50);
      const g = ollamaClient({ baseUrl: 'http://x', model: 'gemma3:4b' }); for await (const _ of g.stream!(args())); expect(seen[1].think).toBeUndefined();
    } finally { globalThis.fetch = real; }
  });
  it('complete() strips thinking and runs one call at a time', async () => {
    let active = 0, peak = 0; const real = globalThis.fetch;
    globalThis.fetch = (async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 15)); active--; return new Response(JSON.stringify({ message: { content: '<think>x</think>Answer' } })); }) as any;
    try { const c = ollamaClient({ baseUrl: 'http://x', model: 'qwen3:4b' }); const r = await Promise.all([c.complete(args()), c.complete(args()), c.complete(args())]); expect(r).toEqual(['Answer', 'Answer', 'Answer']); expect(peak).toBe(1); } finally { globalThis.fetch = real; }
  });
  it('reports health and whether the model is downloaded; never throws', async () => {
    const ok = (async () => new Response(JSON.stringify({ models: [{ name: 'qwen3:4b' }] }))) as any;
    expect(await ollamaHealth({ OLLAMA_MODEL: 'qwen3:4b' } as any, ok)).toMatchObject({ up: true, modelAvailable: true });
    expect(await ollamaHealth({ OLLAMA_MODEL: 'gemma3:4b' } as any, ok)).toMatchObject({ up: true, modelAvailable: false });
    expect(await ollamaHealth({} as any, (async () => { throw new Error('refused'); }) as any)).toMatchObject({ up: false, modelAvailable: false });
  });
});
