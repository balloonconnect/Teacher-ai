// Measures the local model on THIS machine: how fast it answers and how much it can do. Run it before you raise OLLAMA_CONCURRENCY.
//   node scripts/ollama-bench.mjs            (uses OLLAMA_BASE_URL / OLLAMA_MODEL from the environment)
const base = (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/+$/, '');
const model = process.env.OLLAMA_MODEL ?? 'qwen3:4b';
const prompts = [
  ['English', 'In two short sentences, explain what photosynthesis is to a Class 8 student.'],
  ['Tamil', 'ஒளிச்சேர்க்கை என்றால் என்ன? 8ஆம் வகுப்பு மாணவருக்கு இரண்டு எளிய வாக்கியங்களில் விளக்கவும்.'],
  ['Both', 'Explain photosynthesis in simple Tamil first, then in simple English, in 3 sentences each.'],
];
const think = /qwen3|deepseek-r1/i.test(model);
async function one(label, content) {
  const t0 = Date.now(); let first = 0, text = '', tokens = 0;
  const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true, ...(think ? { think: false } : {}), options: { num_predict: 200, temperature: 0.3 }, messages: [{ role: 'user', content }] }) });
  if (!r.ok) throw new Error(`Ollama ${r.status} — is "${model}" pulled? (ollama pull ${model})`);
  const dec = new TextDecoder(); let buf = '';
  for await (const part of r.body) { buf += dec.decode(part, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; const j = JSON.parse(line); if (j.message?.content) { if (!first) first = Date.now() - t0; text += j.message.content; } if (j.done) tokens = j.eval_count ?? 0; } }
  const ms = Date.now() - t0; console.log(`\n[${label}] first text ${first} ms · total ${ms} ms · ${tokens ? (tokens / (ms / 1000)).toFixed(1) : '?'} tokens/s\n${text.trim()}`);
}
console.log(`Model ${model} at ${base}`);
try { for (const [l, p] of prompts) await one(l, p); console.log('\nRead the Tamil answer yourself (or ask a Tamil teacher) before choosing this model for live use.'); } catch (e) { console.error(String(e.message ?? e)); process.exit(1); }
