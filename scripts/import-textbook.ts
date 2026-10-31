/**
 * Dev-time importer: turns the text extracted from an official textbook PDF into short, source-labelled lesson excerpts.
 *   npx tsx scripts/import-textbook.ts english8 <extracted-text.json|.txt> server/curriculum/class8-english.json
 * Only a short excerpt of each lesson is kept (full textbooks are not stored in the repo).
 */
import { readFileSync, writeFileSync } from 'node:fs';

type Piece = { kind: 'prose' | 'poem' | 'supp' | 'play'; unit: number; title: string; page: number };
export const ENGLISH8: Piece[] = [
  { kind: 'prose', unit: 1, title: 'The Nose-Jewel', page: 1 }, { kind: 'poem', unit: 1, title: 'Special Hero', page: 22 }, { kind: 'supp', unit: 1, title: 'The Woman on Platform 8', page: 26 },
  { kind: 'prose', unit: 2, title: 'Hobby Turns into a Successful Career', page: 35 }, { kind: 'poem', unit: 2, title: 'My Hobby: Reading', page: 53 }, { kind: 'supp', unit: 2, title: 'A Hunter Turned Naturalist', page: 58 },
  { kind: 'prose', unit: 3, title: 'Sir Isaac Newton -The Ingenious Scientist', page: 63 }, { kind: 'poem', unit: 3, title: 'Making Life Worth While', page: 79 }, { kind: 'supp', unit: 3, title: 'The Three Questions', page: 83 },
  { kind: 'prose', unit: 4, title: 'My Reminiscence', page: 92 }, { kind: 'poem', unit: 4, title: 'A Thing of Beauty', page: 108 }, { kind: 'supp', unit: 4, title: 'Crossing the River', page: 112 },
  { kind: 'prose', unit: 5, title: 'Being Safe', page: 120 }, { kind: 'poem', unit: 5, title: 'Fire Work Night', page: 139 }, { kind: 'supp', unit: 5, title: 'When Instinct Works', page: 143 },
  { kind: 'prose', unit: 6, title: 'Friendship', page: 151 }, { kind: 'poem', unit: 6, title: 'Lessons in Life', page: 171 }, { kind: 'supp', unit: 6, title: 'Homeless Man and his Friends', page: 175 },
  { kind: 'prose', unit: 7, title: 'Cyber Safety', page: 180 }, { kind: 'poem', unit: 7, title: 'My Computer Needs a Break', page: 199 }, { kind: 'supp', unit: 7, title: 'The Mystery of the Cyber Friend', page: 204 },
  { kind: 'play', unit: 8, title: 'Jack and the Beanstalk', page: 215 },
];
const KIND = {
  prose: { en: 'Prose', ta: 'உரைநடை', goals: { en: ['Read the text and understand its main idea', 'Learn new words from the text', 'Answer questions about what you read'], ta: ['பாடத்தைப் படித்து முக்கியக் கருத்தைப் புரிந்துகொள்ளுதல்', 'பாடத்திலிருந்து புதிய சொற்களைக் கற்றல்', 'படித்ததைப் பற்றிய கேள்விகளுக்குப் பதிலளித்தல்'] } },
  poem: { en: 'Poem', ta: 'கவிதை', goals: { en: ['Read the poem aloud and follow its ideas', 'Notice rhyme and pictures in the words', 'Say what the poem means in your own words'], ta: ['கவிதையை உரக்கப் படித்து அதன் கருத்தைப் பின்பற்றுதல்', 'எதுகை மோனை, சொற்படிமங்களைக் கவனித்தல்', 'கவிதையின் பொருளைச் சொந்த வார்த்தைகளில் கூறுதல்'] } },
  supp: { en: 'Supplementary reader', ta: 'துணைப்பாடம்', goals: { en: ['Read the story for enjoyment and understanding', 'Find the main events and ideas', 'Connect it to the unit theme'], ta: ['கதையை மகிழ்ந்து படித்துப் புரிந்துகொள்ளுதல்', 'முக்கிய நிகழ்வுகளையும் கருத்துகளையும் கண்டறிதல்', 'அலகின் மையக்கருத்துடன் இணைத்துப் பார்த்தல்'] } },
  play: { en: 'Play', ta: 'நாடகம்', goals: { en: ['Read the play with different voices', 'Follow the characters and the plot', 'Retell the story in your own words'], ta: ['வெவ்வேறு குரல்களில் நாடகத்தைப் படித்தல்', 'கதைமாந்தர்களையும் கதைப்போக்கையும் பின்பற்றுதல்', 'கதையைச் சொந்த வார்த்தைகளில் கூறுதல்'] } },
} as const;

const clean = (raw: string) => raw.replace(/\\([_*!.\-#>()])/g, '$1').split('\n').filter(l => !/\.indd|^\s*\d{1,3}\s*$|^\s*\d\d[-/]\d\d[-/]\d{4}|tntextbooks|^\s*[IVX]{1,5}\s*$/.test(l)).join('\n');

export function segment(text0: string, pieces: Piece[]) {
  const text = text0.replace(/\\([_*!.\-#>()])/g, '$1');
  const start = text.indexOf('Contents Unit Page'); let pos = start; // skip the printed contents page
  const found: { p: Piece; from: number }[] = []; const missing: string[] = [];
  for (const p of pieces) {
    const re = new RegExp(`^\\s*\\*?${p.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\-/g, '[-–]?\\s*')}\\s*$`, 'im'); const m = re.exec(text.slice(pos));
    if (!m) { missing.push(p.title); continue; } const from = pos + m.index; found.push({ p, from }); pos = from + m[0].length;
  }
  if (missing.length) console.warn(`NOT FOUND in the extracted text (not imported): ${missing.join('; ')}`);
  return found.map((f, i) => ({ ...f.p, raw: text.slice(f.from, found[i + 1]?.from ?? text.length) }));
}
export function excerpt(raw: string, minLen = 50) {
  const blocks = clean(raw).split(/\n\s*\n/).map(b => b.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim()).filter(b => b.length >= minLen && /[a-z]{3}/.test(b));
  const out: string[] = []; let cur = '';
  for (const b of blocks) { if (cur && (cur + ' ' + b).length > 520) { out.push(cur); cur = ''; if (out.length >= 6) break; } cur = cur ? `${cur} ${b}` : b; if (cur.length > 700) { out.push(cur.slice(0, 520).replace(/\s\S*$/, '…')); cur = ''; if (out.length >= 6) break; } }
  if (cur && out.length < 6) out.push(cur.length > 700 ? cur.slice(0, 520).replace(/\s\S*$/, '…') : cur);
  return out;
}

if (process.argv[1]?.endsWith('import-textbook.ts')) {
  const [, , which, inFile, outFile] = process.argv; if (which !== 'english8') throw new Error('Only english8 is configured. Tamil and Mathematics need usable text (see docs/KNOWN_LIMITATIONS.md).');
  const rawIn = readFileSync(inFile, 'utf8'); const text: string = rawIn.trimStart().startsWith('{') ? JSON.parse(rawIn).fileContent : rawIn;
  const src = 'Samacheer Kalvi Class 8 English, Tamil Nadu Textbook and Educational Services Corporation (2024 edition) — short excerpt';
  const lessons = segment(text, ENGLISH8).map((s, i) => {
    const parts = excerpt(s.raw, s.kind === 'poem' ? 22 : 50); if (!parts.length) throw new Error(`No text for ${s.title}`); const k = KIND[s.kind];
    return { id: `c8-english-u${s.unit}-${s.kind}`, class_level: 8, subject_id: 'english', chapter_no: s.unit, chapter_en: s.kind === 'play' ? 'Play' : `Unit ${s.unit}`, chapter_ta: s.kind === 'play' ? 'நாடகம்' : `அலகு ${s.unit}`,
      title_en: s.title, title_ta: s.title, minutes: s.kind === 'poem' ? 10 : 15, position: 10 + i, source: `${src}; "${s.title}" starts on page ${s.page}.`,
      content: { textbookPage: s.page, kind: k.en, objectives: k.goals, sections: parts.map((p, j) => ({ h_en: `Part ${j + 1}: ${p.split(' ').slice(0, 4).join(' ')}…`, h_ta: `${k.ta}: பகுதி ${j + 1}`, en: p })) } };
  });
  writeFileSync(outFile, JSON.stringify({ subject: 'english', class_level: 8, lessons }, null, 1)); console.log('wrote', outFile, lessons.length, 'lessons', lessons.map(l => l.content.sections.length).join(','));
}
