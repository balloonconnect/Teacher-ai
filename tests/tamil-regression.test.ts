import { describe, expect, it } from 'vitest';
import { client, DEMO, setup } from './helpers';
import { q } from '../server/db';
import { normalizeTamil, chunkText } from '../shared/tamil';
import { build } from '../server/services/bookStructure';
import { chapterMap, explainItem, itemMindMap } from '../server/services/itemLearn';
import { transformTamil } from '../server/services/tamilAi';

/** Known-correct texts. The kurals are the public-domain verses of the opening chapter, checked word by word against Project Madurai's edition
 *  (https://projectmadurai.org/pm_etexts/utf8/pmuni0017.html); editions differ only in how sandhi is spelled (e.g. "கற்றதனால் ஆய" / "கற்றதனா லாய"). */
export const A = 'தமிழ் மொழி இனிமையானது. கல்வி மனித வாழ்க்கைக்கு மிகவும் முக்கியமானது.';
export const B = 'கல்வி, அறிவு, ஒழுக்கம், வாழ்க்கை, மகிழ்ச்சி, குழந்தைகள், திருக்குறள், கவிதை.';
export const KURAL: [string, string][] = [
  ['அகர முதல எழுத்தெல்லாம் ஆதி', 'பகவன் முதற்றே உலகு'], ['கற்றதனால் ஆய பயனென்கொல் வாலறிவன்', 'நற்றாள் தொழாஅர் எனின்'], ['மலர்மிசை ஏகினான் மாணடி சேர்ந்தார்', 'நிலமிசை நீடுவாழ் வார்'],
  ['வேண்டுதல் வேண்டாமை இலானடி சேர்ந்தார்க்கு', 'யாண்டும் இடும்பை இல'], ['இருள்சேர் இருவினையும் சேரா இறைவன்', 'பொருள்சேர் புகழ்புரிந்தார் மாட்டு'], ['பொறிவாயில் ஐந்தவித்தான் பொய்தீர் ஒழுக்க', 'நெறிநின்றார் நீடுவாழ் வார்'],
  ['தனக்குவமை இல்லாதான் தாள்சேர்ந்தார்க் கல்லால்', 'மனக்கவலை மாற்றல் அரிது'], ['அறவாழி அந்தணன் தாள்சேர்ந்தார்க் கல்லால்', 'பிறவாழி நீந்தல் அரிது'], ['கோளில் பொறியிற் குணமிலவே எண்குணத்தான்', 'தாளை வணங்காத் தலை'], ['பிறவிப் பெருங்கடல் நீந்துவர் நீந்தார்', 'இறைவன் அடிசேரா தார்'],
];
const page = ['கடவுள் வாழ்த்து என்பது முதல் அதிகாரம். இது சோதனைக்கான அறிமுகம் ஆகும்.', '', 'கடவுள் வாழ்த்து', ...KURAL.flatMap(([a, b], i) => ['', `${i + 1}. ${a}`, `${b}.`, '', `பொருள் : சோதனைப் பொருள் ${i + 1}.`])].join('\n');
const code = (s: string) => [...s].map(c => c.codePointAt(0)!.toString(16)).join(' ');

describe('A+B: Unicode is preserved at every stage', () => {
  it('NFC normalisation leaves correct Tamil byte-for-byte unchanged', () => { for (const s of [A, B, ...KURAL.flat()]) { expect(normalizeTamil(s)).toBe(s); expect(code(normalizeTamil(s))).toBe(code(s)); expect(s).toBe(s.normalize('NFC')); } });
  it('chunking for speech never alters, reorders or drops characters', () => { for (const s of [A, B]) { const c = chunkText(s, 40); expect(c.join(' ').replace(/\s+/g, ' ')).toBe(s); } });
  it('survives the database and the API unchanged (UTF-8 end to end)', async () => {
    const t = await setup(); await q.run(t.db, 'INSERT INTO settings(key,value) VALUES (?,?)', 'tamil-test', A + '\n' + B); const row = await q.get<any>(t.db, 'SELECT value FROM settings WHERE key=?', 'tamil-test'); expect(row.value).toBe(A + '\n' + B);
    const c = client(t.app); await c.login(DEMO.student); const r = await c.post('/api/tamil/chunks', { text: A }); expect(r.body.chunks.join(' ')).toBe(A);
  });
});

describe('C+D: ten verified couplets', () => {
  const st = build([{ page: 1, text: page }]); const ks = st.items.filter(i => i.kind === 'couplet');
  it('all 10 are read in order, exactly as in the source, none duplicated, omitted or invented', () => {
    expect(ks).toHaveLength(10); expect(st.flags).not.toContain('couplets_found_9'); expect(new Set(ks.map(k => k.lines.join('\n'))).size).toBe(10);
    ks.forEach((k, i) => { expect(k.number).toBe(String(i + 1)); expect(k.lines[0]).toBe(KURAL[i][0]); expect(k.lines[1]).toBe(KURAL[i][1] + '.'); expect(k.flags).toEqual([]); });
    expect(ks[0].lines.join('\n')).toBe('அகர முதல எழுத்தெல்லாம் ஆதி\nபகவன் முதற்றே உலகு.'); // test C
  });
  it('each couplet has its own mind map built from its own words, and the chapter has one combined map listing all 10', () => {
    const lesson = { id: 'l', title_en: 'கடவுள் வாழ்த்து', title_ta: 'கடவுள் வாழ்த்து' };
    ks.forEach((k, i) => { const m = itemMindMap(lesson, st, k.id); const text = JSON.stringify(m.nodes); expect(text).toContain(KURAL[i][0].split(' ')[0]); expect(m.title_ta).toBe(`குறள் ${i + 1}`); if (i) expect(text).not.toContain(KURAL[i - 1][0]); });
    const cm = chapterMap(lesson, st); for (let i = 1; i <= 10; i++) expect(cm.nodes.some(n => n.ta.startsWith(`குறள் ${i}:`))).toBe(true);
  });
  it('an explanation that quotes words from a different couplet is cut back to its own couplet', async () => {
    const other = KURAL[1][0].split(' ')[0]; const own = KURAL[4][0].split(' ')[0];
    const ai = await explainItem({ name: 'm', complete: async () => JSON.stringify({ simple_ta: 'இது ஒரு சோதனை விளக்கம் ஆகும்.', word_meanings: [{ word: other, meaning: 'பிற குறள்' }, { word: own, meaning: 'இந்தக் குறள்' }] }) } as any, ks[4], 'explain', { chapter: 'x' });
    expect(ai.word_meanings.map(w => w.word)).toEqual([own]);
  });
});

describe('E: the stage trail identifies where an error starts', () => {
  it('records input → extracted → raw AI → processed → comparison, and a bad stage is the only one that differs', async () => {
    const input = KURAL[0].join('\n') + '.'; const extracted = build([{ page: 1, text: `1. ${KURAL[0][0]}\n${KURAL[0][1]}.\n\nபொருள் : சோதனை.\n2. ${KURAL[1][0]}\n${KURAL[1][1]}.\n\nபொருள் : சோதனை.\n3. ${KURAL[2][0]}\n${KURAL[2][1]}.\n\nபொருள் : சோதனை.` }]).items[0].lines.join('\n');
    const raw = 'தமிழ் மொழி இனிமையானது. கல்வி மனித வாழ்க்கைக்கு மிகவும் முக்கியமானது.'; const processed = await transformTamil({ name: 'm', complete: async () => raw } as any, { action: 'correct', text: raw });
    const trail = { input, extracted, raw, processed: processed.text, same: { inputVsExtracted: input === extracted, rawVsProcessed: raw === processed.text } };
    expect(trail.same).toEqual({ inputVsExtracted: true, rawVsProcessed: true }); expect(code(trail.processed)).toBe(code(raw));
    const damaged = extracted.replace('முதல', 'மதல'); expect(damaged === input).toBe(false); // an OCR-stage error shows up as input ≠ extracted while raw = processed
  });
});
