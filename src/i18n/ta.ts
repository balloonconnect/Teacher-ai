import { UI } from './ta-ui';
import { TEXT } from './ta-text';
import { TEXT2 } from './ta-text2';
import { MSG } from './ta-msg';
import { SRV } from './ta-srv';
import { BOOK } from './ta-book';

/**
 * Tamil for the interface. Key = the exact English phrase shown on screen (whitespace collapsed). Value = natural written Tamil, as a teacher would say it to a child.
 * Please have a Tamil teacher review these files (ta.ts, ta-ui.ts, ta-text.ts, ta-text2.ts): every line is what students read in தமிழ் mode.
 * Phrases with numbers or names go in PATTERNS below.
 */
export const TA: Record<string, string> = { ...UI, ...TEXT, ...TEXT2, ...MSG, ...SRV, ...BOOK };

const DAYS: Record<string, string> = { Mon: 'திங்', Tue: 'செவ்', Wed: 'புத', Thu: 'வியா', Fri: 'வெள்', Sat: 'சனி', Sun: 'ஞாயி' };
const SUBJ = 'English|Mathematics|Science|Social Science|Tamil';
const NOUN: Record<string, string> = { lesson: 'பாடம்', lessons: 'பாடங்கள்', question: 'கேள்வி', questions: 'கேள்விகள்', mark: 'மதிப்பெண்', marks: 'மதிப்பெண்கள்', min: 'நிமிடம்', mins: 'நிமிடங்கள்', day: 'நாள்', days: 'நாட்கள்',
  attempt: 'முயற்சி', attempts: 'முயற்சிகள்', chapter: 'அலகு', chapters: 'அலகுகள்', topic: 'தலைப்பு', topics: 'தலைப்புகள்', book: 'புத்தகம்', books: 'புத்தகங்கள்', page: 'பக்கம்', pages: 'பக்கங்கள்', test: 'தேர்வு', tests: 'தேர்வுகள்', unread: 'படிக்கப்படாதவை',
  certificate: 'சான்றிதழ்', certificates: 'சான்றிதழ்கள்', concept: 'கருத்து', concepts: 'கருத்துகள்', word: 'சொல்', words: 'சொற்கள்', example: 'எடுத்துக்காட்டு', examples: 'எடுத்துக்காட்டுகள்' };
const when = (s: string, tr: (x: string) => string) => tr(s.replace(/\b(AM|PM)\b/, m => (m === 'AM' ? 'முற்பகல்' : 'பிற்பகல்')));

/** Phrases that carry numbers, dates or names. Each returns the Tamil text. */
export const PATTERNS: [RegExp, (m: RegExpExecArray, tr: (s: string) => string) => string][] = [
  [/^(.+?), pages? (\d+)(?:–(\d+))?\. Read from the textbook PDF( \(still being read\))?; scanned text can contain a few wrong letters\.$/, m => `${m[1]}, ${m[3] ? `பக்கங்கள் ${m[2]}–${m[3]}` : `பக்கம் ${m[2]}`}. பாடநூல் PDF-இலிருந்து படிக்கப்பட்டது${m[4] ? ' (இன்னும் படிக்கப்படுகிறது)' : ''}; ஸ்கேன் செய்த எழுத்தில் சில எழுத்துப் பிழைகள் இருக்கலாம்.`],
  [/^Page (\d+)(?:–(\d+))?$/, m => m[2] ? `பக்கம் ${m[1]}–${m[2]}` : `பக்கம் ${m[1]}`],
  [/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2})$/, m => `${DAYS[m[1]]} ${m[2]}`],
  [/^(?:· )?Class (\d{1,2})$/, m => `${m[0].startsWith('·') ? '· ' : ''}${m[1]}-ஆம் வகுப்பு`],
  [/^Ref (.+)$/, m => `குறிப்பு எண் ${m[1]}`],
  [new RegExp(`^(${SUBJ}) — Weekly Test (\\d+)( \\(written answer\\))?$`), (m, tr) => `${tr(m[1])} — வாராந்திரத் தேர்வு ${m[2]}${m[3] ? ' (எழுத்து விடை)' : ''}`],
  [/^(·\s)?(\d+) (min|mins|lessons?|questions?|marks?|days?|attempts?|chapters?|topics?|books?|pages?|tests?|certificates?|concepts?|words?|examples?|unread)(\)?\.?)$/, m => `${m[1] ?? ''}${m[2]} ${NOUN[m[3]]}${m[4] ?? ''}`],
  [/^(Closes|Opens|closes|opens) (.+)$/, (m, tr) => `${/^[Cc]/.test(m[1]) ? 'முடிவு' : 'தொடக்கம்'}: ${when(m[2], tr)}`],
  [/^This test opens (.+?)\.?$/, (m, tr) => `இந்தத் தேர்வு ${when(m[1], tr)} அன்று திறக்கும்.`],
  [/^· (closes|opens) (.+)$/, (m, tr) => `· ${m[1] === 'closes' ? 'முடிவு' : 'தொடக்கம்'}: ${when(m[2], tr)}`],
  [/\b(AM|PM)\b/, (m, tr) => when(m.input, tr)],
  [/^(\d+) to complete$/, m => `முடிக்க வேண்டியவை: ${m[1]}`],
  [/^Notifications(?:, (\d+) unread)?$/, m => (m[1] ? `அறிவிப்புகள், ${m[1]} படிக்கப்படாதவை` : 'அறிவிப்புகள்')],
  [/^(Delete|Remove|Open|Edit|Rename|Download|Print) (.+)$/, (m, tr) => `${({ Delete: 'நீக்கு', Remove: 'நீக்கு', Open: 'திற', Edit: 'திருத்து', Rename: 'பெயர்மாற்று', Download: 'பதிவிறக்கு', Print: 'அச்சிடு' } as Record<string, string>)[m[1]]}: ${tr(m[2])}`],
  [/^Hello,? (.+)$/, m => `வணக்கம், ${m[1]}`],
  [/^Good (morning|afternoon|evening),? (.+)$/, m => `${m[1] === 'morning' ? 'காலை' : m[1] === 'afternoon' ? 'மதிய' : 'மாலை'} வணக்கம், ${m[2]}`],
  [/^Page (\d+)( of (\d+))?$/, m => `பக்கம் ${m[1]}${m[3] ? ` / ${m[3]}` : ''}`],
  [/^Step (\d+)( of (\d+))?$/, m => `படி ${m[1]}${m[3] ? ` / ${m[3]}` : ''}`],
  [/^Question (\d+)( of (\d+))?$/, m => `கேள்வி ${m[1]}${m[3] ? ` / ${m[3]}` : ''}`],
  [/^(\d+)\s*\/\s*(\d+) marks$/, m => `${m[1]} / ${m[2]} மதிப்பெண்கள்`],
  [/^(\d+)% (.+)$/, (m, tr) => `${m[1]}% ${tr(m[2])}`],
];
