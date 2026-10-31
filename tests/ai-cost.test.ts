import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { anthropicClient, openaiClient, setUsageSink, type TokenUse } from '../server/services/llmEngine';
import { estimateCost } from '../server/routes/roles';
import { openDb, q } from '../server/db';

let mode: 'a' | 'o' | 'astream' = 'a';
const server = http.createServer((req, res) => {
  req.resume(); req.on('end', () => {
    if (mode === 'astream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 120 } } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 33 } })}\n\n`);
      res.end(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`); return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(mode === 'a' ? { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 50, output_tokens: 7 } } : { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 40, completion_tokens: 9 } }));
  });
});
let base = ''; beforeAll(async () => { await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r())); base = `http://127.0.0.1:${(server.address() as any).port}`; });
afterAll(() => { setUsageSink(null); server.close(); });
const args = () => ({ system: 's', user: 'u', maxTokens: 50, signal: new AbortController().signal });

describe('AI token and cost tracking', () => {
  it('reports the tokens the provider returns (Anthropic, OpenAI-compatible, streaming)', async () => {
    const got: TokenUse[] = []; setUsageSink(u => got.push(u));
    mode = 'a'; await anthropicClient({ apiKey: 'k', model: 'm', baseUrl: base }).complete(args());
    mode = 'o'; await openaiClient({ model: 'g', baseUrl: base }).complete(args());
    mode = 'astream'; for await (const _ of anthropicClient({ apiKey: 'k', model: 'm', baseUrl: base }).stream!(args())) { /* drain */ }
    expect(got).toEqual([{ provider: 'anthropic:m', input: 50, output: 7 }, { provider: 'openai-compatible:g', input: 40, output: 9 }, { provider: 'anthropic:m', input: 120, output: 33 }]);
  });
  it('a failing sink never breaks a call', async () => {
    setUsageSink(() => { throw new Error('db down'); }); mode = 'a';
    await expect(anthropicClient({ apiKey: 'k', model: 'm', baseUrl: base }).complete(args())).resolves.toBe('ok');
  });
  it('estimates cost only when prices are set', async () => {
    const db = await openDb(':memory:'); const now = new Date().toISOString();
    await q.run(db, 'INSERT INTO ai_token_usage(provider,input_tokens,output_tokens,at) VALUES (?,?,?,?)', 'p', 2_000_000, 500_000, now);
    const none = await estimateCost(db, {} as any); expect(none).toMatchObject({ priced: false, total: null, inputTokens: 2_000_000, outputTokens: 500_000, calls: 1 });
    const c = await estimateCost(db, { LLM_PRICE_IN_PER_MTOK: '3', LLM_PRICE_OUT_PER_MTOK: '15' } as any); expect(c.total).toBe(13.5); expect(c.thisMonth).toBe(13.5);
  });
});
