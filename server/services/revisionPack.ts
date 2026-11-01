import { Item, Structure } from './bookStructure';
import { TEMPLATES, formatOf } from './learnTemplates';

/**
 * Time-boxed revision packs (1, 5, 15 and 30 minutes) built by the app from a chapter's own items — no AI.
 * The time for each step is an estimate (reading speed from the length of the text), so the pack tells the student what to do in the time they have.
 * Items the student struggled with come first, then the chapter's main items in book order.
 */
export type PackStep = { kind: 'glance' | 'read' | 'recall' | 'quiz' | 'words'; itemId?: string; itemIds?: string[]; minutes: number };
export type Pack = { minutes: number; steps: PackStep[]; total: number; covered: number; of: number; note: string };
export const PACK_MINUTES = [1, 5, 15, 30] as const;

const READ_CHARS_PER_MIN = 700;
const main = (i: Item) => ['couplet', 'stanza', 'poem', 'paragraph', 'device'].includes(i.kind) && i.lines.length > 0;
const readMin = (i: Item) => Math.max(0.3, Math.round((i.lines.join(' ').length / READ_CHARS_PER_MIN) * 10) / 10);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildPack(st: Structure, minutes: number, need: string[] = []): Pack {
  const items = st.items.filter(main); const needSet = new Set(need);
  const ordered = [...items.filter(i => needSet.has(i.id)), ...items.filter(i => !needSet.has(i.id))];
  const words = st.items.filter(i => i.kind === 'word');
  const steps: PackStep[] = []; let used = 0; const covered = new Set<string>();
  const add = (s: PackStep) => { steps.push(s); used = r1(used + s.minutes); };
  const fits = (m: number) => used + m <= minutes + 1e-9;

  if (minutes <= 1) {
    // one minute: a quick look at as many main items as fit
    for (const i of ordered) { const m = 0.15; if (!fits(m)) break; add({ kind: 'glance', itemId: i.id, minutes: m }); covered.add(i.id); }
  } else {
    // keep about a fifth of the time for the word list and a closing quiz in the longer packs
    const reserveWords = minutes >= 15 && words.length ? Math.min(3, r1(words.length * 0.1)) : 0;
    for (const i of ordered) {
      const quiz = minutes >= 15 && TEMPLATES[formatOf(i)].quiz;
      const group: PackStep[] = [{ kind: 'read', itemId: i.id, minutes: readMin(i) }, { kind: 'recall', itemId: i.id, minutes: 0.5 }];
      if (quiz) group.push({ kind: 'quiz', itemId: i.id, minutes: 1 });
      const cost = r1(group.reduce((a, s) => a + s.minutes, 0));
      if (used + cost + reserveWords > minutes + 1e-9) { if (steps.length) break; continue; }
      group.forEach(add); covered.add(i.id);
    }
    if (words.length && minutes >= 5) {
      const room = r1(minutes - used); const n = Math.min(words.length, Math.floor(room / 0.1));
      if (n >= 3) add({ kind: 'words', itemIds: words.slice(0, n).map(w => w.id), minutes: r1(n * 0.1) });
    }
  }
  return { minutes, steps, total: r1(used), covered: covered.size, of: items.length, note: covered.size < items.length ? `This pack covers ${covered.size} of ${items.length} main items. A longer pack covers more.` : 'This pack covers every main item.' };
}
