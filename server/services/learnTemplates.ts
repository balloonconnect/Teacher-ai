import { Item } from './bookStructure';

/**
 * One learning template per kind of textbook content. A template lists the parts a student gets, and where each part comes from:
 *  textbook = the book's own text as read, ai = written by the model (always labelled), rule = built by the app from the textbook text.
 * Only parts that fit the item are listed (a grammar rule has no character list; an author note has no metre). The renderer and the model prompt
 * both read this table, so a new content type is one more entry here, not new code.
 */
export type Format = 'kural' | 'poem' | 'stanza' | 'prose' | 'story' | 'grammar' | 'vocab' | 'author' | 'proverb' | 'idiom' | 'writing' | 'comprehension' | 'exercise' | 'devices' | 'info';
export type Source = 'textbook' | 'ai' | 'rule';
export type Part = { key: string; en: string; ta: string; source: Source };
export type Template = { format: Format; en: string; ta: string; parts: Part[]; shape: string; task: string; quiz: boolean };

const P = (key: string, en: string, ta: string, source: Source): Part => ({ key, en, ta, source });
const SRC = P('source', 'Original textbook text', 'பாடநூலில் உள்ளபடி', 'textbook');
const WORDS = '"word_meanings":[{"word":"<a word copied exactly from the text>","meaning":"<simple meaning>"}]';
const QUIZ = '"quiz":{"question":"<one question about THIS text only>","options":["<3 or 4 options>"],"correct":<index of the right option, from 0>,"hint":"<a hint that does not give the answer>","why":"<why the right option is right and the common wrong idea is wrong>"}';
const KW = '"keywords":["<3-5 words>"]';

export const TEMPLATES: Record<Format, Template> = {
  kural: { format: 'kural', en: 'Thirukkural', ta: 'திருக்குறள்', quiz: true,
    parts: [SRC, P('meaning', 'Textbook meaning', 'பாடநூல் பொருள்', 'textbook'), P('word_meanings', 'Word meanings', 'சொல் பொருள்', 'ai'), P('simple_ta', 'Simple explanation', 'எளிய விளக்கம்', 'ai'), P('detailed', 'Detailed interpretation', 'விரிவான விளக்கம்', 'ai'), P('real_life', 'Real-life example', 'வாழ்வியல் எடுத்துக்காட்டு', 'ai'), P('takeaway', 'Key takeaway', 'முக்கியக் கருத்து', 'ai'), P('memory_tip', 'Memory note', 'நினைவுக் குறிப்பு', 'ai'), P('map', 'Mind map', 'மனவரைபடம்', 'rule'), P('quiz', 'Check yourself', 'சோதிக்க', 'ai'), P('exam_notes', 'Exam notes', 'தேர்வுக் குறிப்புகள்', 'ai')],
    task: 'Explain this Thirukkural couplet for a school student.', shape: `{${WORDS},"simple_ta":"<the couplet in simple words>","detailed":"<a fuller interpretation>","real_life":"<an example from school, family, friends or society>","takeaway":"<the lesson in one line>","central_idea":"<one line>","memory_tip":"<a short way to remember it>",${KW},${QUIZ},"exam_notes":"<what to remember for the exam>","english":"<English meaning>"}` },
  poem: { format: 'poem', en: 'Poem', ta: 'கவிதை', quiz: true,
    parts: [SRC, P('word_meanings', 'Difficult words', 'அருஞ்சொற்பொருள்', 'ai'), P('line_notes', 'Line-by-line meaning', 'அடிதோறும் பொருள்', 'ai'), P('summary', 'Complete meaning', 'முழுப் பொருள்', 'ai'), P('central_idea', 'Central theme', 'மையக் கருத்து', 'ai'), P('imagery', 'Emotions and imagery', 'உணர்வும் உருவகமும்', 'ai'), P('devices', 'Literary devices', 'நயங்கள்', 'ai'), P('real_life', 'Real-life connection', 'வாழ்க்கைத் தொடர்பு', 'ai'), P('map', 'Mind map', 'மனவரைபடம்', 'rule'), P('key_points', 'Revision points', 'திருப்புதல் குறிப்புகள்', 'ai'), P('quiz', 'Check yourself', 'சோதிக்க', 'ai')],
    task: 'Explain this poem for a school student, line by line.', shape: `{"line_notes":[{"line":"<a line copied exactly>","note":"<simple explanation>"}],"summary":"<meaning of the whole poem>","central_idea":"<theme and the poet's intention>","imagery":"<emotions and imagery that are really in the text>","devices":["<only devices really present, e.g. எதுகை, மோனை, with the words>"],"real_life":"<a connection to life>","key_points":["..."],${WORDS},${KW},${QUIZ}}` },
  stanza: { format: 'stanza', en: 'Stanza', ta: 'பாடல்', quiz: true,
    parts: [SRC, P('word_meanings', 'Difficult words', 'அருஞ்சொற்பொருள்', 'ai'), P('line_notes', 'Line-by-line meaning', 'அடிதோறும் பொருள்', 'ai'), P('summary', 'Stanza meaning', 'பாடலின் பொருள்', 'ai'), P('central_idea', 'Central idea', 'மையக் கருத்து', 'ai'), P('devices', 'Literary devices', 'நயங்கள்', 'ai'), P('map', 'Mind map', 'மனவரைபடம்', 'rule'), P('quiz', 'Check yourself', 'சோதிக்க', 'ai')],
    task: 'Explain this stanza for a school student, line by line.', shape: `{"line_notes":[{"line":"<a line copied exactly>","note":"<simple explanation>"}],"summary":"<meaning>","central_idea":"<one line>","devices":["<only devices really present>"],${WORDS},${KW},${QUIZ}}` },
  prose: { format: 'prose', en: 'Prose section', ta: 'உரைநடைப் பகுதி', quiz: true,
    parts: [SRC, P('simple_ta', 'Simple explanation', 'எளிய விளக்கம்', 'ai'), P('word_meanings', 'Difficult words', 'அருஞ்சொற்பொருள்', 'ai'), P('key_points', 'Key points and facts', 'முக்கியக் கருத்துகள்', 'ai'), P('sequence', 'Order of ideas', 'கருத்துகளின் வரிசை', 'ai'), P('cause_effect', 'Cause and effect', 'காரணமும் விளைவும்', 'ai'), P('real_life', 'Real-life example', 'வாழ்வியல் எடுத்துக்காட்டு', 'ai'), P('summary', 'Section summary', 'பகுதிச் சுருக்கம்', 'ai'), P('map', 'Mind map', 'மனவரைபடம்', 'rule'), P('quiz', 'Check yourself', 'சோதிக்க', 'ai')],
    task: 'Explain this section of a prose lesson for a school student.', shape: `{"simple_ta":"<explanation in simple words>","key_points":["..."],"sequence":["<events or ideas in the order they appear>"],"cause_effect":["<cause → effect, only if the text has one>"],"real_life":"<an example>","summary":"<one or two sentences>",${WORDS},${KW},${QUIZ}}` },
  story: { format: 'story', en: 'Story section', ta: 'கதைப் பகுதி', quiz: true,
    parts: [SRC, P('simple_ta', 'What happens', 'நிகழ்வு', 'ai'), P('characters', 'Characters', 'கதைமாந்தர்', 'ai'), P('sequence', 'Order of events', 'நிகழ்வுகளின் வரிசை', 'ai'), P('cause_effect', 'Cause and effect', 'காரணமும் விளைவும்', 'ai'), P('takeaway', 'Theme and moral', 'கருத்தும் நீதியும்', 'ai'), P('word_meanings', 'Difficult words', 'அருஞ்சொற்பொருள்', 'ai'), P('map', 'Mind map', 'மனவரைபடம்', 'rule'), P('quiz', 'Check yourself', 'சோதிக்க', 'ai')],
    task: 'Explain this part of a story for a school student without spoiling how it ends beyond what the text says.', shape: `{"simple_ta":"<what happens here>","characters":[{"name":"<name in the text>","trait":"<trait shown in the text>"}],"sequence":["..."],"cause_effect":["..."],"takeaway":"<theme or moral, only if this part shows it>",${WORDS},${KW},${QUIZ}}` },
  grammar: { format: 'grammar', en: 'Grammar', ta: 'இலக்கணம்', quiz: true,
    parts: [SRC, P('definition', 'Rule and definition', 'விதியும் வரையறையும்', 'ai'), P('simple_ta', 'How it works', 'எவ்வாறு செயல்படுகிறது', 'ai'), P('types', 'Types', 'வகைகள்', 'ai'), P('examples', 'Examples', 'எடுத்துக்காட்டுகள்', 'ai'), P('compare', 'Compare with similar rules', 'ஒப்பீடு', 'ai'), P('mistakes', 'Common mistakes', 'பொதுவான தவறுகள்', 'ai'), P('memory_tip', 'Memory aid', 'நினைவுக் குறிப்பு', 'ai'), P('quiz', 'Apply the rule', 'பயன்படுத்திப் பார்', 'ai'), P('exam_notes', 'Exam notes', 'தேர்வுக் குறிப்புகள்', 'ai')],
    task: 'Teach this Tamil grammar point to a school student so that they can apply it to new words.', shape: `{"definition":"<the rule in simple words>","simple_ta":"<how it works>","types":["<types, only if the text gives them>"],"examples":["<examples that follow the rule; prefer ones in the text>"],"compare":"<one easily confused rule and the difference>","mistakes":[{"wrong":"<a wrong use>","right":"<the correct use>","why":"<why>"}],"memory_tip":"<a short aid>",${WORDS},${KW},${QUIZ},"exam_notes":"<what to remember>"}` },
  vocab: { format: 'vocab', en: 'Vocabulary', ta: 'சொல் வளம்', quiz: false,
    parts: [SRC, P('simple_ta', 'Usage in a sentence', 'வாக்கியப் பயன்பாடு', 'ai')],
    task: 'Give a short example sentence for this word and its meaning.', shape: '{"simple_ta":"<a short example sentence that uses the word>","keywords":["<related words>"]}' },
  author: { format: 'author', en: 'Author or book', ta: 'நூல் / ஆசிரியர்', quiz: false,
    parts: [SRC, P('summary', 'Why it matters for this lesson', 'பாடத்துடன் தொடர்பு', 'ai'), P('key_points', 'Key facts from the text', 'உரையில் உள்ள முக்கியக் குறிப்புகள்', 'ai')],
    task: 'Summarise ONLY the facts that appear in this text about the author or book. Add no biography from your own knowledge.', shape: '{"summary":"<how this connects to the lesson, using only the text>","key_points":["<facts that are in the text>"]}' },
  proverb: { format: 'proverb', en: 'Proverb', ta: 'பழமொழி', quiz: true,
    parts: [SRC, P('simple_ta', 'Meaning', 'பொருள்', 'ai'), P('takeaway', 'Underlying message', 'உள்ளுறை கருத்து', 'ai'), P('real_life', 'Real-life example', 'வாழ்வியல் எடுத்துக்காட்டு', 'ai'), P('quiz', 'Check yourself', 'சோதிக்க', 'ai')],
    task: 'Explain this proverb for a school student.', shape: `{"simple_ta":"<meaning>","takeaway":"<the message>","real_life":"<an example>",${QUIZ}}` },
  idiom: { format: 'idiom', en: 'Idiom', ta: 'மரபுத்தொடர்', quiz: true,
    parts: [SRC, P('simple_ta', 'Meaning', 'பொருள்', 'ai'), P('examples', 'Example sentences', 'எடுத்துக்காட்டு வாக்கியங்கள்', 'ai'), P('quiz', 'Check yourself', 'சோதிக்க', 'ai')],
    task: 'Explain this idiom for a school student with example sentences.', shape: `{"simple_ta":"<meaning>","examples":["<sentences>"],${QUIZ}}` },
  writing: { format: 'writing', en: 'Letter, essay or creative writing', ta: 'கடிதம் / கட்டுரை / படைப்பாக்கம்', quiz: false,
    parts: [SRC, P('structure', 'Structure and parts', 'அமைப்பு', 'ai'), P('key_points', 'Language conventions', 'மொழி நடை', 'ai'), P('examples', 'Model example', 'மாதிரி', 'ai'), P('steps', 'Guided writing steps', 'எழுதும் படிகள்', 'ai')],
    task: 'Guide a school student to write this kind of text, step by step.', shape: '{"structure":["<the parts in order>"],"key_points":["<conventions>"],"examples":["<a short model, clearly an example>"],"steps":["<guided steps>"]}' },
  comprehension: { format: 'comprehension', en: 'Reading comprehension', ta: 'படித்துப் புரிந்துகொள்', quiz: true,
    parts: [SRC, P('central_idea', 'Central idea', 'மையக் கருத்து', 'ai'), P('key_points', 'Important details', 'முக்கிய விவரங்கள்', 'ai'), P('word_meanings', 'Vocabulary', 'சொல் பொருள்', 'ai'), P('quiz', 'Check yourself', 'சோதிக்க', 'ai')],
    task: 'Help a school student understand this passage.', shape: `{"central_idea":"<one line>","key_points":["..."],${WORDS},${QUIZ}}` },
  exercise: { format: 'exercise', en: 'Textbook question', ta: 'பாடநூல் வினா', quiz: false,
    parts: [SRC, P('answer', 'Suggested answer', 'பரிந்துரைக்கப்படும் விடை', 'ai'), P('why', 'Why', 'ஏன்', 'ai')],
    task: 'Write a suggested answer for this textbook question, suitable for the marks.', shape: '{"answer":"<a suggested answer>","why":"<one line on why>"}' },
  devices: { format: 'devices', en: 'Poetic devices', ta: 'நயம்', quiz: false,
    parts: [SRC, P('simple_ta', 'Explained', 'விளக்கம்', 'ai')], task: 'Explain these poetic devices simply.', shape: '{"simple_ta":"<explanation>","examples":["<examples from the text>"]}' },
  info: { format: 'info', en: 'Lesson text', ta: 'பாடக் குறிப்பு', quiz: false,
    parts: [SRC, P('simple_ta', 'Simple explanation', 'எளிய விளக்கம்', 'ai'), P('key_points', 'Key points', 'முக்கியக் குறிப்புகள்', 'ai')],
    task: 'Explain this text simply for a school student.', shape: `{"simple_ta":"<explanation>","key_points":["..."],${WORDS},${KW}}` },
};

/** Which template an item gets, from what the structure reader found. Computed on read, so lessons read earlier need no re-sync. */
export function formatOf(it: Pick<Item, 'kind' | 'section' | 'lines' | 'title'>, lessonKind?: 'story' | 'prose'): Format {
  switch (it.kind) {
    case 'couplet': return 'kural'; case 'poem': return 'poem'; case 'stanza': return 'stanza'; case 'word': return 'vocab'; case 'device': return 'devices'; case 'question': return 'exercise'; case 'objective': return 'info';
  }
  const text = `${it.title ?? ''} ${it.lines.join(' ')}`;
  if (it.section === 'author') return 'author'; if (it.section === 'grammar') return 'grammar'; if (it.section === 'poem') return 'info';
  if (it.section === 'proverb' as any) return 'proverb'; if (it.section === 'idiom' as any) return 'idiom'; if (it.section === 'writing' as any) return 'writing';
  if (it.section === 'prose' || it.section === 'body') return /கடிதம்|கட்டுரை/.test(text.slice(0, 60)) ? 'writing' : lessonKind === 'story' ? 'story' : it.kind === 'paragraph' ? 'prose' : 'info';
  return 'info';
}
/** A chapter is treated as a story when its title or a heading says so. */
export const lessonKindOf = (title: string, st: { segments?: { heading: string }[] }): 'story' | undefined => /கதை|சிறுகதை|\bstory\b/i.test([title, ...(st.segments ?? []).map(s => s.heading)].join(' ')) ? 'story' : undefined;
export const templateOf = (it: Parameters<typeof formatOf>[0], k?: 'story' | 'prose') => TEMPLATES[formatOf(it, k)];
