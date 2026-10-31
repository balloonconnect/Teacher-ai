import { LlmClient } from './llmEngine';
import { hasTamil, missingProtected, normalizeTamil, tamilShare } from './tamilText';

/**
 * Tamil language-quality layer: one model call per action (no rewrite loops, so cost stays predictable), followed by
 * deterministic checks that catch the failures a grammar tool must never have: dropped dates/amounts/names, an answer that
 * is not Tamil, runaway length (invented content), and chatter around the answer. A result that fails a check is rejected
 * and the caller keeps the original text. Meaning-preservation beyond these checks is the model's job and is NOT verified here.
 */
export const TAMIL_ACTIONS = ['correct', 'simplify', 'formal', 'conversational', 'to_tamil', 'to_english'] as const;
export type TamilAction = typeof TAMIL_ACTIONS[number];
export const MAX_TAMIL_INPUT = 4000;

export const TAMIL_SYSTEM = [
  'You are Karikai AI\'s expert Tamil language and educational content engine. Write natural, grammatically correct, meaningful Tamil using standard Tamil Unicode.',
  'Understand the complete context before producing the answer. Preserve the intended meaning, names, facts, sequence, and educational context. Use appropriate written Tamil, correct spelling, proper grammar, natural sentence construction, and suitable punctuation.',
  'Never generate random Tamil words, broken sentences, meaningless combinations, or unnecessary transliterations. Do not translate content into another language and back into Tamil as a substitute for understanding the source.',
  'When processing textbooks, preserve the original verses, poems, questions, lesson headings, and numbering. Do not invent missing source material or present AI-generated content as original textbook content.',
  'If the source is an OCR extraction, correct only errors that can be resolved confidently from context. If a word or passage cannot be recovered reliably, leave it unchanged rather than guessing.',
  'Return the requested content in readable Tamil script. Never invent facts, names, numbers or sentences that are not in the source. Keep every name, date, address, amount, phone number and religious name exactly as written. Reply with the resulting text only: no explanation, no quotation marks, no heading.',
].join(' ');

const TASK: Record<TamilAction, string> = {
  correct: 'Correct the spelling, grammar, punctuation and sentence construction of the Tamil text below. Keep the meaning, the order and the length. Change only what is wrong.',
  simplify: 'Rewrite the Tamil text below in simpler Tamil for a school student: shorter sentences and everyday words, the same meaning, no new information.',
  formal: 'Rewrite the Tamil text below in formal written Tamil (செந்தமிழ் எழுத்து நடை), with the same meaning and no new information.',
  conversational: 'Rewrite the Tamil text below in natural, polite spoken (conversational) Tamil, written in Tamil script, with the same meaning and no new information.',
  to_tamil: 'Translate the text below into natural, grammatically correct Tamil in Tamil script. Translate directly from the source; keep names, numbers and dates exactly.',
  to_english: 'Translate the Tamil text below into clear English. Translate directly from the Tamil; keep names, numbers and dates exactly.',
};
export class TamilAiError extends Error { name = 'TamilAiError'; constructor(m: string, public status = 502, public detail?: any) { super(m); } }

const strip = (raw: string) => normalizeTamil(raw.replace(/^```[a-z]*\n?|\n?```$/g, '').replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').replace(/^(?:Tamil|English|Corrected|Translation|தமிழ்|ஆங்கிலம்)\s*[:：]\s*/i, ''));

/** Checks a model result against its source. Returns a reason when the result must not be used. */
export function checkResult(action: TamilAction, source: string, result: string): string | null {
  if (!result) return 'The model returned nothing.';
  const sameLang = action !== 'to_tamil' && action !== 'to_english';
  if (action !== 'to_english') {
    const srcLatinHeavy = tamilShare(source) < 0.3;
    if (!hasTamil(result) || (!srcLatinHeavy && tamilShare(result) < 0.6) || (action === 'to_tamil' && tamilShare(result) < 0.6)) return 'The result is not in Tamil script.';
  } else if (tamilShare(result) > 0.2) return 'The result was not translated into English.';
  const ratio = result.length / Math.max(1, source.length);
  if (sameLang && (ratio > 2.5 || (action !== 'simplify' && ratio < 0.4) || ratio < 0.2)) return 'The result is much longer or shorter than the original, so it may contain invented or missing content.';
  if (!sameLang && (ratio > 5 || ratio < 0.1)) return 'The translation length is implausible.';
  // digits must survive everywhere; Latin names/words must survive when the language stays the same
  const lost = missingProtected(source, result).filter(t => sameLang || /^\d/.test(t));
  if (lost.length) return `The result dropped details from the original: ${lost.slice(0, 5).join(', ')}.`;
  return null;
}

export async function transformTamil(client: LlmClient, a: { action: TamilAction; text: string; audience?: string; signal?: AbortSignal; timeoutMs?: number }) {
  if (!TAMIL_ACTIONS.includes(a.action)) throw new TamilAiError('Unknown action.', 400);
  const source = normalizeTamil(a.text);
  if (!source) throw new TamilAiError('There is no text to work on.', 400);
  if (source.length > MAX_TAMIL_INPUT) throw new TamilAiError(`The text is too long (limit ${MAX_TAMIL_INPUT} characters). Select a shorter part.`, 413);
  if (a.action !== 'to_tamil' && !hasTamil(source) && a.action !== 'to_english') throw new TamilAiError('This text has no Tamil in it. Use “Translate into Tamil” instead.', 400);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), a.timeoutMs ?? 30000); a.signal?.addEventListener('abort', () => ac.abort());
  let raw: string;
  try { raw = await client.complete({ system: TAMIL_SYSTEM, user: `${TASK[a.action]}${a.audience ? `\nAudience: ${a.audience}.` : ''}\n\n---\n${source}\n---`, maxTokens: Math.min(4096, Math.ceil(source.length * 2.2) + 200), signal: ac.signal }); }
  catch (e: any) { throw new TamilAiError(ac.signal.aborted ? 'The language service took too long. Please try again.' : 'The language service could not be reached. Please try again.', 502); }
  finally { clearTimeout(t); }
  const text = strip(raw); const why = checkResult(a.action, source, text);
  if (why) throw new TamilAiError(`The suggestion was not used. ${why} Your original text is unchanged.`, 422, { reason: why });
  return { text, original: source, changed: text !== source, action: a.action };
}
