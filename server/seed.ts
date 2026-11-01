import { DB, q, tx } from './db';
import { upsertTextbookLessons } from './curriculum';
import { bookOnly } from './bookOnly';
import { hashPassword, uid } from './security';
import { iso, clock } from './clock';
import { randomBytes } from 'node:crypto';

const SAMPLE = 'Sample content written for this prototype — not the official Samacheer Kalvi textbook.';
export const DEMO_PASSWORD = 'demo@12345';
// Development-only login usernames (resolved only when SEED_DEMO != 0)
export const DEMO_USERNAMES: Record<string, string> = { vikikalvi: 'meena@demo.kavli.local', 'vikikalvi-parent': 'parent@demo.kavli.local', 'vikikalvi-teacher': 'teacher@demo.kavli.local', 'vikikalvi-school': 'school@demo.kavli.local', 'vikikalvi-admin': 'admin@demo.kavli.local' };
export const readableId = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;

const subjects = [
  ['maths', 'Mathematics', 'கணிதம்'], ['science', 'Science', 'அறிவியல்'], ['english', 'English', 'ஆங்கிலம்'],
  ['social', 'Social Science', 'சமூக அறிவியல்'], ['tamil', 'Tamil', 'தமிழ்'],
];

const lessons: any[] = [
  { id: 'c8-maths-linear', class_level: 8, subject_id: 'maths', chapter_no: 1, chapter_en: 'Algebra', chapter_ta: 'இயற்கணிதம்', title_en: 'Solving linear equations', title_ta: 'ஒருபடிச் சமன்பாடுகளைத் தீர்த்தல்', minutes: 15, position: 1,
    content: {
      objectives: { en: ['Understand what an equation is', 'Solve equations like 3x + 5 = 20 step by step', 'Check the answer by substitution'], ta: ['சமன்பாடு என்றால் என்ன என்பதைப் புரிந்துகொள்ளுதல்', '3x + 5 = 20 போன்ற சமன்பாடுகளைப் படிப்படியாகத் தீர்த்தல்', 'மதிப்பைப் பிரதியிட்டுச் சரிபார்த்தல்'] },
      sections: [
        { h_en: 'What is an equation?', h_ta: 'சமன்பாடு என்றால் என்ன?', en: 'An equation says that two expressions are equal. In 3x + 5 = 20, we look for the value of x that makes both sides equal. Think of a balance: whatever you do to one side, do to the other side too.', ta: 'இரண்டு கோவைகள் சமம் என்று கூறுவது சமன்பாடு. 3x + 5 = 20 இல் இரு பக்கங்களையும் சமமாக்கும் x இன் மதிப்பைக் காண்கிறோம். தராசைப் போல, ஒரு பக்கத்தில் செய்வதை மறுபக்கத்திலும் செய்ய வேண்டும்.' },
        { h_en: 'Solve step by step', h_ta: 'படிப்படியாகத் தீர்க்கும் முறை', en: 'Step 1: remove the number added to x by subtracting it from both sides. Step 2: remove the multiplier by dividing both sides. Step 3: check your answer.', ta: 'படி 1: x உடன் கூட்டிய எண்ணை இரு பக்கமும் கழிக்கவும். படி 2: x இன் பெருக்கு எண்ணால் இரு பக்கமும் வகுக்கவும். படி 3: விடையைச் சரிபார்க்கவும்.' },
      ],
      vocab: [
        { en: 'Equation', ta: 'சமன்பாடு', meaning: 'A statement that two things are equal', pron: 'sa-man-paadu', example: '2x = 10' },
        { en: 'Variable', ta: 'மாறி', meaning: 'A letter that stands for an unknown number', pron: 'maa-ri', example: 'x in 3x + 5 = 20' },
        { en: 'Coefficient', ta: 'கெழு', meaning: 'The number multiplying a variable', pron: 'ke-zhu', example: '3 in 3x' },
      ],
      examples: [{ q_en: 'Solve 3x + 5 = 20', q_ta: '3x + 5 = 20 ஐத் தீர்க்க', steps_en: ['Subtract 5 from both sides: 3x = 15', 'Divide both sides by 3: x = 5', 'Check: 3 × 5 + 5 = 20 ✓'], steps_ta: ['இரு பக்கமும் 5 ஐக் கழிக்க: 3x = 15', 'இரு பக்கமும் 3 ஆல் வகுக்க: x = 5', 'சரிபார்த்தல்: 3 × 5 + 5 = 20 ✓'] }],
      realLife: { en: 'Pencils cost ₹3 each and a notebook costs ₹5. You pay ₹20 in all. How many pencils? 3x + 5 = 20 gives x = 5.', ta: 'ஒரு பென்சில் ₹3, குறிப்பேடு ₹5. மொத்தம் ₹20 கொடுத்தால் எத்தனை பென்சில்? 3x + 5 = 20 இலிருந்து x = 5.' },
      mistakes: [{ en: 'Subtracting 5 from only one side.', ta: 'ஒரு பக்கத்தில் மட்டும் 5 ஐக் கழித்தல்.' }, { en: 'Dividing only the x term, not the whole side.', ta: 'முழுப் பக்கத்தையும் வகுக்காமல் x உறுப்பை மட்டும் வகுத்தல்.' }],
    } },
  { id: 'c8-maths-ratio', class_level: 8, subject_id: 'maths', chapter_no: 2, chapter_en: 'Ratio and proportion', chapter_ta: 'விகிதம் மற்றும் விகிதசமம்', title_en: 'Ratio and proportion', title_ta: 'விகிதம் மற்றும் விகிதசமம்', minutes: 12, position: 2,
    content: {
      objectives: { en: ['Write a ratio in simplest form', 'Check whether two ratios are in proportion'], ta: ['விகிதத்தை எளிய வடிவில் எழுதுதல்', 'இரு விகிதங்கள் விகிதசமமா எனச் சரிபார்த்தல்'] },
      sections: [{ h_en: 'Ratio', h_ta: 'விகிதம்', en: 'A ratio compares two quantities of the same kind. 12 : 18 simplifies to 2 : 3 by dividing both by 6. Two equal ratios are in proportion.', ta: 'ஒரே வகையான இரு அளவுகளை ஒப்பிடுவது விகிதம். 12 : 18 ஐ இரண்டையும் 6 ஆல் வகுத்து 2 : 3 என எளிமைப்படுத்தலாம். இரு சம விகிதங்கள் விகிதசமம் ஆகும்.' }],
      vocab: [{ en: 'Ratio', ta: 'விகிதம்', meaning: 'Comparison of two quantities', pron: 'vi-gi-tham', example: '2 : 3' }, { en: 'Proportion', ta: 'விகிதசமம்', meaning: 'Equality of two ratios', pron: 'vi-gi-tha-sa-mam', example: '2 : 3 = 4 : 6' }],
      examples: [{ q_en: 'If 4 pens cost ₹20, what do 7 pens cost?', q_ta: '4 பேனாக்கள் ₹20 எனில் 7 பேனாக்களின் விலை?', steps_en: ['One pen costs 20 ÷ 4 = ₹5', '7 pens cost 7 × 5 = ₹35'], steps_ta: ['ஒரு பேனா = 20 ÷ 4 = ₹5', '7 பேனாக்கள் = 7 × 5 = ₹35'] }],
      realLife: { en: 'Mixing 2 cups of rice with 3 cups of water is the ratio 2 : 3.', ta: '2 கோப்பை அரிசிக்கு 3 கோப்பை தண்ணீர் என்பது 2 : 3 விகிதம்.' },
      mistakes: [{ en: 'Comparing quantities with different units.', ta: 'வெவ்வேறு அலகுகளுள்ள அளவுகளை ஒப்பிடுதல்.' }],
    } },
  { id: 'c8-science-force', class_level: 8, subject_id: 'science', chapter_no: 1, chapter_en: 'Force and pressure', chapter_ta: 'விசையும் அழுத்தமும்', title_en: 'Force and pressure', title_ta: 'விசையும் அழுத்தமும்', minutes: 14, position: 1,
    content: {
      objectives: { en: ['Define force and its SI unit', 'Explain pressure = force ÷ area'], ta: ['விசையையும் அதன் SI அலகையும் வரையறுத்தல்', 'அழுத்தம் = விசை ÷ பரப்பு என விளக்குதல்'] },
      sections: [{ h_en: 'Force', h_ta: 'விசை', en: 'A push or a pull is a force. Its SI unit is the newton (N). Pressure is the force acting on each unit of area: pressure = force ÷ area. The same force on a smaller area gives more pressure, which is why a sharp knife cuts easily.', ta: 'தள்ளுதல் அல்லது இழுத்தல் விசை எனப்படும். அதன் SI அலகு நியூட்டன் (N). ஓரலகு பரப்பில் செயல்படும் விசை அழுத்தம்: அழுத்தம் = விசை ÷ பரப்பு. அதே விசை சிறிய பரப்பில் செயல்பட்டால் அழுத்தம் அதிகம்; அதனால்தான் கூர்மையான கத்தி எளிதாக வெட்டுகிறது.' }],
      vocab: [{ en: 'Force', ta: 'விசை', meaning: 'A push or a pull', pron: 'vi-sai', example: 'Kicking a ball' }, { en: 'Pressure', ta: 'அழுத்தம்', meaning: 'Force on a unit area', pron: 'a-zhut-tham', example: 'A needle pressing on cloth' }],
      examples: [{ q_en: 'A force of 100 N acts on an area of 4 m². Find the pressure.', q_ta: '4 மீ² பரப்பில் 100 N விசை செயல்படுகிறது. அழுத்தத்தைக் காண்க.', steps_en: ['Pressure = force ÷ area', '100 ÷ 4 = 25 N/m²'], steps_ta: ['அழுத்தம் = விசை ÷ பரப்பு', '100 ÷ 4 = 25 N/m²'] }],
      realLife: { en: 'Camels have wide feet so they do not sink in sand.', ta: 'ஒட்டகத்தின் அகன்ற பாதங்கள் மணலில் அழுந்தாமல் தடுக்கின்றன.' },
      mistakes: [{ en: 'Confusing force with pressure.', ta: 'விசையையும் அழுத்தத்தையும் குழப்புதல்.' }],
    } },
  { id: 'c8-english-nouns', class_level: 8, subject_id: 'english', chapter_no: 1, chapter_en: 'Grammar', chapter_ta: 'இலக்கணம்', title_en: 'Nouns', title_ta: 'பெயர்ச்சொற்கள்', minutes: 10, position: 1,
    content: {
      objectives: { en: ['Identify nouns in sentences'], ta: ['வாக்கியங்களில் பெயர்ச்சொற்களை அடையாளம் காணுதல்'] },
      sections: [{ h_en: 'What is a noun?', h_ta: 'பெயர்ச்சொல் என்றால் என்ன?', en: 'A noun is a word that names a person, place, thing or idea. In "Meena reads a book in the library", Meena, book and library are nouns.', ta: 'நபர், இடம், பொருள் அல்லது கருத்தைக் குறிக்கும் சொல் பெயர்ச்சொல். "Meena reads a book in the library" என்பதில் Meena, book, library ஆகியவை பெயர்ச்சொற்கள்.' }],
      vocab: [{ en: 'Noun', ta: 'பெயர்ச்சொல்', meaning: 'A naming word', pron: 'pe-yar-chol', example: 'school' }],
      examples: [{ q_en: 'Find the noun: "The dog barked."', q_ta: 'பெயர்ச்சொல்லைக் காண்க: "The dog barked."', steps_en: ['Who or what? The dog', 'Noun: dog'], steps_ta: ['யார்/எது? நாய்', 'பெயர்ச்சொல்: dog'] }],
      realLife: { en: 'Everything around you — table, teacher, Chennai — is named by a noun.', ta: 'உங்களைச் சுற்றியுள்ள மேசை, ஆசிரியர், சென்னை — அனைத்தும் பெயர்ச்சொற்களே.' },
      mistakes: [{ en: 'Thinking only names of people are nouns.', ta: 'நபர்களின் பெயர்கள் மட்டுமே பெயர்ச்சொல் என நினைத்தல்.' }],
    } },
  { id: 'c8-social-directions', class_level: 8, subject_id: 'social', chapter_no: 1, chapter_en: 'Maps', chapter_ta: 'வரைபடங்கள்', title_en: 'Directions and maps', title_ta: 'திசைகளும் வரைபடங்களும்', minutes: 12, position: 1,
    content: {
      objectives: { en: ['Name the main and intermediate directions', 'Use a map scale'], ta: ['முதன்மைத் திசைகளையும் இடைத் திசைகளையும் கூறுதல்', 'வரைபட அளவுகோலைப் பயன்படுத்துதல்'] },
      sections: [{ h_en: 'Directions', h_ta: 'திசைகள்', en: 'The four main directions are north, east, south and west. Between them are north-east, south-east, south-west and north-west. A map scale such as 1 cm = 10 km tells you how real distance is shown on the map.', ta: 'வடக்கு, கிழக்கு, தெற்கு, மேற்கு ஆகியவை நான்கு முதன்மைத் திசைகள். இவற்றிற்கிடையே வடகிழக்கு, தென்கிழக்கு, தென்மேற்கு, வடமேற்கு உள்ளன. 1 செ.மீ = 10 கி.மீ போன்ற அளவுகோல் வரைபடத்தில் உண்மைத் தூரம் எவ்வாறு காட்டப்படுகிறது என்பதைக் கூறும்.' }],
      vocab: [{ en: 'Scale', ta: 'அளவுகோல்', meaning: 'Relation between map distance and real distance', pron: 'a-la-vu-kol', example: '1 cm = 10 km' }],
      examples: [{ q_en: 'Two towns are 3 cm apart on a map with scale 1 cm = 10 km. Real distance?', q_ta: 'அளவுகோல் 1 செ.மீ = 10 கி.மீ உள்ள வரைபடத்தில் இரு நகரங்கள் 3 செ.மீ தூரத்தில் உள்ளன. உண்மைத் தூரம்?', steps_en: ['3 × 10 = 30 km'], steps_ta: ['3 × 10 = 30 கி.மீ'] }],
      realLife: { en: 'A phone map uses scale to show how far a place is.', ta: 'கைபேசி வரைபடம் அளவுகோலைக் கொண்டே தூரத்தைக் காட்டுகிறது.' },
      mistakes: [{ en: 'Reading the scale in the wrong unit.', ta: 'அளவுகோலைத் தவறான அலகில் படித்தல்.' }],
    } },
  { id: 'c8-tamil-noun', class_level: 8, subject_id: 'tamil', chapter_no: 1, chapter_en: 'Grammar', chapter_ta: 'இலக்கணம்', title_en: 'Nouns in Tamil (பெயர்ச்சொல்)', title_ta: 'பெயர்ச்சொல்', minutes: 10, position: 1,
    content: {
      objectives: { en: ['Recognise a Tamil noun'], ta: ['தமிழ்ப் பெயர்ச்சொல்லை அறிதல்'] },
      sections: [{ h_en: 'Noun', h_ta: 'பெயர்ச்சொல்', en: 'A noun names a person, place or thing. Examples: மரம் (tree), மாணவன் (student), சென்னை (Chennai).', ta: 'ஒரு நபர், இடம் அல்லது பொருளின் பெயரைக் குறிப்பது பெயர்ச்சொல். எ.கா: மரம், மாணவன், சென்னை.' }],
      vocab: [{ en: 'Noun', ta: 'பெயர்ச்சொல்', meaning: 'Naming word', pron: 'pe-yar-chol', example: 'மரம்' }],
      examples: [{ q_en: 'Find the noun: "மாணவன் படித்தான்"', q_ta: 'பெயர்ச்சொல்லைக் காண்க: "மாணவன் படித்தான்"', steps_en: ['மாணவன் (student) names a person'], steps_ta: ['மாணவன் ஒரு நபரைக் குறிக்கிறது'] }],
      realLife: { en: 'Names of your friends and your town are nouns.', ta: 'உங்கள் நண்பர்கள் மற்றும் ஊரின் பெயர்கள் பெயர்ச்சொற்கள்.' },
      mistakes: [{ en: 'Mixing nouns and verbs.', ta: 'பெயர்ச்சொல்லையும் வினைச்சொல்லையும் குழப்புதல்.' }],
    } },
];
for (let c = 1; c <= 12; c++) if (c !== 8) lessons.push({ id: `c${c}-maths-intro`, class_level: c, subject_id: 'maths', chapter_no: 1, chapter_en: 'Number sense', chapter_ta: 'எண் உணர்வு', title_en: `Class ${c} Mathematics — sample lesson`, title_ta: `வகுப்பு ${c} கணிதம் — மாதிரிப் பாடம்`, minutes: 10, position: 1,
  content: { objectives: { en: ['Placeholder lesson showing the content structure'], ta: ['உள்ளடக்க அமைப்பைக் காட்டும் மாதிரிப் பாடம்'] }, sections: [{ h_en: 'Placeholder', h_ta: 'மாதிரி', en: `Official Class ${c} content has not been imported yet. A reviewer can import licensed curriculum content in the admin console.`, ta: `வகுப்பு ${c} க்கான அதிகாரப்பூர்வ உள்ளடக்கம் இன்னும் இறக்குமதி செய்யப்படவில்லை.` }], vocab: [], examples: [], realLife: { en: '', ta: '' }, mistakes: [] } });

type Q = { id: string; s: string; c: number; ch?: number; t: 'mcq' | 'tf' | 'fill' | 'numeric' | 'short'; en: string; ta?: string; o?: string[]; a: any; m: number; d?: string; ex?: string; ext?: string; topic?: string; origin: 'test' | 'practice' };
const T = (id: string, s: string, ch: number, t: Q['t'], en: string, ta: string, o: string[] | undefined, a: any, ex: string, ext: string, topic: string): Q => ({ id, s, c: 8, ch, t, en, ta, o, a, m: 1, ex, ext, topic, origin: 'test' });
const testQs: Q[] = [
  T('t-m1', 'maths', 1, 'mcq', 'Solve: 3x + 5 = 20', '3x + 5 = 20 ஐத் தீர்க்க', ['x = 3', 'x = 5', 'x = 7', 'x = 15'], 1, 'Subtract 5: 3x = 15, then divide by 3: x = 5.', '5 ஐக் கழித்தால் 3x = 15; 3 ஆல் வகுத்தால் x = 5.', 'One-step equations'),
  T('t-m2', 'maths', 1, 'mcq', 'Solve: 5x − 3 = 22', '5x − 3 = 22 ஐத் தீர்க்க', ['x = 4', 'x = 5', 'x = 6', 'x = 25'], 1, 'Add 3: 5x = 25, divide by 5: x = 5.', '3 ஐக் கூட்டினால் 5x = 25; 5 ஆல் வகுத்தால் x = 5.', 'Two-step equations'),
  T('t-m3', 'maths', 1, 'mcq', 'A number increased by 7 gives 19. The number is…', 'ஒரு எண்ணுடன் 7 ஐக் கூட்டினால் 19 கிடைக்கும். அந்த எண்…', ['10', '12', '14', '26'], 1, 'x + 7 = 19 so x = 12.', 'x + 7 = 19 ஆகையால் x = 12.', 'Forming equations'),
  T('t-m4', 'maths', 1, 'tf', 'In the equation 2x = 10, the value of x is 5.', '2x = 10 என்ற சமன்பாட்டில் x இன் மதிப்பு 5.', ['True', 'False'], 0, '10 ÷ 2 = 5, so the statement is true.', '10 ÷ 2 = 5; எனவே கூற்று சரி.', 'One-step equations'),
  T('t-m5', 'maths', 1, 'numeric', 'In 4x = 20, x = ?', '4x = 20 எனில் x = ?', undefined, { value: 5 }, 'Divide both sides by 4.', 'இரு பக்கமும் 4 ஆல் வகுக்க.', 'One-step equations'),
  T('t-m6', 'maths', 1, 'numeric', 'Solve 2(x − 3) = 10. x = ?', '2(x − 3) = 10 ஐத் தீர்க்க. x = ?', undefined, { value: 8 }, 'x − 3 = 5, so x = 8.', 'x − 3 = 5 ஆகையால் x = 8.', 'Two-step equations'),
  T('t-m7', 'maths', 1, 'mcq', 'Twice a number minus 4 equals 10. Which equation matches?', 'ஒரு எண்ணின் இரு மடங்கிலிருந்து 4 ஐக் கழித்தால் 10. பொருந்தும் சமன்பாடு?', ['2x − 4 = 10', '2(x − 4) = 10', '2 + x − 4 = 10', 'x/2 − 4 = 10'], 0, 'Twice a number is 2x; minus 4 gives 2x − 4 = 10.', 'எண்ணின் இரு மடங்கு 2x; 4 ஐக் கழித்தால் 2x − 4 = 10.', 'Equation word problems'),
  T('t-m8', 'maths', 1, 'numeric', 'If 3x/4 = 9, then x = ?', '3x/4 = 9 எனில் x = ?', undefined, { value: 12 }, 'Multiply by 4: 3x = 36, divide by 3: x = 12.', '4 ஆல் பெருக்க 3x = 36; 3 ஆல் வகுக்க x = 12.', 'Equation word problems'),
  T('t-m9', 'maths', 1, 'short', 'Solve and explain each step: 5(x − 2) = 3x + 4', 'ஒவ்வொரு படியையும் விளக்கித் தீர்க்க: 5(x − 2) = 3x + 4', undefined, { rubric: 'x = 7. Expand 5x − 10 = 3x + 4; 2x = 14; x = 7. Marks: expansion, collecting terms, final answer, check.' }, 'Expand: 5x − 10 = 3x + 4; 2x = 14; x = 7.', 'விரிக்க: 5x − 10 = 3x + 4; 2x = 14; x = 7.', 'Equation word problems'),
  T('t-m10', 'maths', 1, 'fill', 'The value of x that satisfies x − 9 = 0 is ____.', 'x − 9 = 0 ஐப் பூர்த்தி செய்யும் x இன் மதிப்பு ____.', undefined, { accept: ['9', 'nine', 'ஒன்பது'] }, 'x = 9.', 'x = 9.', 'One-step equations'),
  T('t-s1', 'science', 1, 'mcq', 'What is the SI unit of force?', 'விசையின் SI அலகு எது?', ['Joule', 'Newton', 'Pascal', 'Watt'], 1, 'Force is measured in newtons (N).', 'விசை நியூட்டனில் (N) அளக்கப்படுகிறது.', 'Force'),
  T('t-s2', 'science', 1, 'tf', 'For the same force, a smaller area gives greater pressure.', 'ஒரே விசைக்கு, சிறிய பரப்பு அதிக அழுத்தத்தைத் தரும்.', ['True', 'False'], 0, 'Pressure = force ÷ area.', 'அழுத்தம் = விசை ÷ பரப்பு.', 'Pressure'),
  T('t-s3', 'science', 1, 'fill', 'Pressure = force ÷ ____.', 'அழுத்தம் = விசை ÷ ____.', undefined, { accept: ['area', 'பரப்பு', 'பரப்பளவு'] }, 'Pressure is force per unit area.', 'அழுத்தம் என்பது ஓரலகு பரப்பின் மீதான விசை.', 'Pressure'),
  T('t-s4', 'science', 1, 'numeric', 'A force of 100 N acts on 4 m². Pressure in N/m² = ?', '4 மீ² மீது 100 N விசை. அழுத்தம் (N/m²) = ?', undefined, { value: 25 }, '100 ÷ 4 = 25.', '100 ÷ 4 = 25.', 'Pressure'),
  T('t-s5', 'science', 1, 'short', 'Why does a sharp knife cut more easily than a blunt one?', 'கூர்மையான கத்தி மழுங்கிய கத்தியை விட எளிதாக ஏன் வெட்டுகிறது?', undefined, { rubric: 'Smaller area of the edge gives more pressure for the same force.' }, 'Smaller contact area, more pressure.', 'சிறிய தொடு பரப்பு, அதிக அழுத்தம்.', 'Pressure'),
  T('t-e1', 'english', 1, 'mcq', 'Which word is a noun? "The teacher smiled."', 'எந்தச் சொல் பெயர்ச்சொல்? "The teacher smiled."', ['The', 'teacher', 'smiled', 'None'], 1, '"teacher" names a person.', '"teacher" ஒரு நபரைக் குறிக்கிறது.', 'Nouns'),
  T('t-e2', 'english', 1, 'tf', '"Chennai" is a noun.', '"Chennai" ஒரு பெயர்ச்சொல்.', ['True', 'False'], 0, 'It names a place.', 'இது ஓர் இடத்தின் பெயர்.', 'Nouns'),
  T('t-e3', 'english', 1, 'fill', 'A ____ names a person, place, thing or idea.', 'நபர், இடம், பொருள், கருத்தைக் குறிப்பது ____.', undefined, { accept: ['noun', 'பெயர்ச்சொல்'] }, 'A noun is a naming word.', 'பெயர்ச்சொல் பெயரைக் குறிக்கும்.', 'Nouns'),
  T('t-e4', 'english', 1, 'short', 'Write two sentences, each with a noun. Underline the nouns.', 'ஒவ்வொன்றிலும் ஒரு பெயர்ச்சொல் வரும்படி இரு வாக்கியங்கள் எழுதுக. பெயர்ச்சொற்களுக்குக் கீழ்க்கோடிடுக.', undefined, { rubric: 'Two sentences each containing a correctly identified noun.' }, 'Any valid noun.', 'சரியான பெயர்ச்சொல் எதுவும்.', 'Nouns'),
  T('t-so1', 'social', 1, 'mcq', 'Which direction is opposite to north-east?', 'வடகிழக்குக்கு எதிர்த் திசை எது?', ['South-west', 'North-west', 'South-east', 'West'], 0, 'Opposite of NE is SW.', 'வடகிழக்கின் எதிர்த்திசை தென்மேற்கு.', 'Directions'),
  T('t-so2', 'social', 1, 'numeric', 'Map scale 1 cm = 10 km. Two towns are 3 cm apart. Real distance in km?', 'அளவுகோல் 1 செ.மீ = 10 கி.மீ. இரு நகரங்கள் 3 செ.மீ தூரம். உண்மைத் தூரம் (கி.மீ)?', undefined, { value: 30 }, '3 × 10 = 30.', '3 × 10 = 30.', 'Scale'),
  T('t-so3', 'social', 1, 'tf', 'A map scale helps us find real distances.', 'வரைபட அளவுகோல் உண்மைத் தூரத்தைக் காண உதவும்.', ['True', 'False'], 0, 'Yes — it relates map distance to real distance.', 'ஆம் — வரைபடத் தூரத்தை உண்மைத் தூரத்துடன் இணைக்கும்.', 'Scale'),
];
const practiceQs: Q[] = [];
const eqs: [number, number, number][] = [[2, 3, 11], [3, 4, 19], [4, 2, 18], [5, 5, 30], [2, 7, 17], [6, 3, 33], [3, 9, 24], [7, 1, 29], [4, 8, 28], [5, 2, 27]];
eqs.forEach(([a, b, c], i) => { const x = (c - b) / a; practiceQs.push({ id: `p-m-eq${i + 1}`, s: 'maths', c: 8, ch: 1, t: 'numeric', en: `Solve: ${a}x + ${b} = ${c}. x = ?`, ta: `${a}x + ${b} = ${c} ஐத் தீர்க்க. x = ?`, a: { value: x }, m: 1, d: i < 4 ? 'easy' : 'medium', ex: `Subtract ${b}: ${a}x = ${c - b}. Divide by ${a}: x = ${x}.`, ext: `${b} ஐக் கழிக்க: ${a}x = ${c - b}. ${a} ஆல் வகுக்க: x = ${x}.`, topic: 'Two-step equations', origin: 'practice' }); });
practiceQs.push(
  { id: 'p-m-tf1', s: 'maths', c: 8, ch: 1, t: 'tf', en: 'x = 4 is a solution of x + 3 = 8.', ta: 'x + 3 = 8 இன் தீர்வு x = 4.', o: ['True', 'False'], a: 1, m: 1, ex: '4 + 3 = 7, not 8, so it is false; x = 5.', ext: '4 + 3 = 7, 8 அல்ல; எனவே தவறு; x = 5.', topic: 'One-step equations', origin: 'practice' },
  { id: 'p-m-fill1', s: 'maths', c: 8, ch: 1, t: 'fill', en: 'To solve x + 6 = 10, subtract ____ from both sides.', ta: 'x + 6 = 10 ஐத் தீர்க்க இரு பக்கமும் ____ ஐக் கழிக்க.', a: { accept: ['6', 'six', 'ஆறு'] }, m: 1, ex: 'Subtract 6 from both sides.', ext: 'இரு பக்கமும் 6 ஐக் கழிக்க.', topic: 'One-step equations', origin: 'practice' },
  { id: 'p-m-r1', s: 'maths', c: 8, ch: 2, t: 'mcq', en: 'Simplest form of 12 : 18 is…', ta: '12 : 18 இன் எளிய வடிவம்…', o: ['1 : 2', '2 : 3', '3 : 4', '6 : 9'], a: 1, m: 1, ex: 'Divide both by 6.', ext: 'இரண்டையும் 6 ஆல் வகுக்க.', topic: 'Ratio', origin: 'practice' },
  { id: 'p-m-r2', s: 'maths', c: 8, ch: 2, t: 'numeric', en: '4 pens cost ₹20. Cost of 7 pens in ₹?', ta: '4 பேனாக்கள் ₹20. 7 பேனாக்களின் விலை (₹)?', a: { value: 35 }, m: 1, ex: '20 ÷ 4 × 7 = 35.', ext: '20 ÷ 4 × 7 = 35.', topic: 'Ratio', origin: 'practice' },
  { id: 'p-m-r3', s: 'maths', c: 8, ch: 2, t: 'tf', en: '3 : 4 and 6 : 8 are in proportion.', ta: '3 : 4 மற்றும் 6 : 8 விகிதசமம்.', o: ['True', 'False'], a: 0, m: 1, ex: 'Both simplify to 3 : 4.', ext: 'இரண்டும் 3 : 4 ஆகச் சுருங்கும்.', topic: 'Ratio', origin: 'practice' },
  { id: 'p-s1', s: 'science', c: 8, ch: 1, t: 'mcq', en: 'Which is a contact force?', ta: 'தொடு விசை எது?', o: ['Gravity', 'Friction', 'Magnetic force', 'Electrostatic force'], a: 1, m: 1, ex: 'Friction acts when surfaces touch.', ext: 'பரப்புகள் தொடும்போது உராய்வு செயல்படும்.', topic: 'Force', origin: 'practice' },
  { id: 'p-s2', s: 'science', c: 8, ch: 1, t: 'numeric', en: 'Force 60 N on area 3 m². Pressure (N/m²)?', ta: '3 மீ² மீது 60 N. அழுத்தம் (N/m²)?', a: { value: 20 }, m: 1, ex: '60 ÷ 3 = 20.', ext: '60 ÷ 3 = 20.', topic: 'Pressure', origin: 'practice' },
  { id: 'p-s3', s: 'science', c: 8, ch: 1, t: 'tf', en: 'Force is measured in newtons.', ta: 'விசை நியூட்டனில் அளக்கப்படும்.', o: ['True', 'False'], a: 0, m: 1, ex: 'N is the SI unit.', ext: 'N என்பது SI அலகு.', topic: 'Force', origin: 'practice' },
  { id: 'p-e1', s: 'english', c: 8, ch: 1, t: 'mcq', en: 'Pick the noun: "Ravi plays football."', ta: 'பெயர்ச்சொல்லைத் தேர்க: "Ravi plays football."', o: ['plays', 'Ravi', 'the', 'quickly'], a: 1, m: 1, ex: 'Ravi names a person (football is also a noun).', ext: 'Ravi ஒரு நபர் (football-உம் பெயர்ச்சொல்).', topic: 'Nouns', origin: 'practice' },
  { id: 'p-so1', s: 'social', c: 8, ch: 1, t: 'mcq', en: 'The direction between north and east is…', ta: 'வடக்கும் கிழக்கும் சந்திக்கும் திசை…', o: ['North-west', 'South-east', 'North-east', 'South-west'], a: 2, m: 1, ex: 'North-east.', ext: 'வடகிழக்கு.', topic: 'Directions', origin: 'practice' },
  { id: 'p-t1', s: 'tamil', c: 8, ch: 1, t: 'mcq', en: 'Which is a noun (பெயர்ச்சொல்)?', ta: 'பெயர்ச்சொல் எது?', o: ['ஓடினான்', 'மரம்', 'விரைவாக', 'அழகாக'], a: 1, m: 1, ex: 'மரம் (tree) names a thing.', ext: 'மரம் ஒரு பொருளின் பெயர்.', topic: 'Nouns', origin: 'practice' },
);

/** Production start (SEED_DEMO=0): the reference data every account needs — the subject list and the real textbook lessons — but no demo users, school or sample content. */
export async function bootstrapProduction(db: DB) {
  if (!(await q.get(db, 'SELECT 1 FROM subjects LIMIT 1'))) await tx(db, async () => { for (const [id, en, ta] of subjects) await q.run(db, 'INSERT INTO subjects VALUES (?,?,?)', id, en, ta); });
  // Practice questions (Class 8 maths equations, Tamil, etc.) are generic study material, not tied to the demo school, so a live site can use Practice and Revise from day one.
  if (!bookOnly() && !(await q.get(db, "SELECT 1 FROM questions WHERE origin='practice' LIMIT 1"))) await tx(db, async () => {
    for (const x of practiceQs) await q.run(db, 'INSERT INTO questions(id,subject_id,class_level,chapter_no,type,text_en,text_ta,options,answer,marks,difficulty,explanation_en,explanation_ta,topic,origin,status,school_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', x.id, x.s, x.c, x.ch ?? null, x.t, x.en, x.ta ?? null, JSON.stringify(x.o ?? []), JSON.stringify(x.a), x.m, x.d ?? 'medium', x.ex ?? null, x.ext ?? null, x.topic ?? null, x.origin, 'published', null);
  });
  if (!bookOnly()) await upsertTextbookLessons(db);
}

export async function seed(db: DB) {
  // textbook lessons are real content: they are also loaded into existing databases (see server/index.ts)
  if ((await q.get(db, 'SELECT 1 FROM users LIMIT 1'))) return;
  const now = clock.now(); const day = 864e5; const at = (d: number, h = 0) => iso(new Date(now.getTime() + d * day + h * 36e5));
  const ts = iso(now);
  const pw = await hashPassword(DEMO_PASSWORD);
  const ay = '2026–2027';
  await tx(db, async () => {
    await q.run(db, 'INSERT INTO schools(id,name,created_at) VALUES (?,?,?)', 'school-demo', 'Demo Government Higher Secondary School (sample)', ts);
    for (const [id, en, ta] of subjects) await q.run(db, 'INSERT INTO subjects VALUES (?,?,?)', id, en, ta);
    if (!bookOnly()) for (const l of lessons) await q.run(db, 'INSERT INTO lessons(id,class_level,subject_id,term,chapter_no,chapter_en,chapter_ta,title_en,title_ta,minutes,position,content,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', l.id, l.class_level, l.subject_id, 1, l.chapter_no, l.chapter_en, l.chapter_ta, l.title_en, l.title_ta, l.minutes, l.position, JSON.stringify(l.content), SAMPLE);
    if (!bookOnly()) await upsertTextbookLessons(db);
    if (!bookOnly()) for (const x of [...testQs, ...practiceQs]) await q.run(db, 'INSERT INTO questions(id,subject_id,class_level,chapter_no,type,text_en,text_ta,options,answer,marks,difficulty,explanation_en,explanation_ta,topic,origin,status,school_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', x.id, x.s, x.c, x.ch ?? null, x.t, x.en, x.ta ?? null, JSON.stringify(x.o ?? []), JSON.stringify(x.a), x.m, x.d ?? 'medium', x.ex ?? null, x.ext ?? null, x.topic ?? null, x.origin, 'published', 'school-demo');
  });
  const mk = async (id: string, email: string, name: string, role: string, school: string | null) => (await q.run(db, 'INSERT INTO users(id,email,display_name,password_hash,role,school_id,consent_at,created_at,is_demo) VALUES (?,?,?,?,?,?,?,?,1)', id, email, name, pw, role, school, ts, ts));
  await mk('u-student', 'meena@demo.kavli.local', 'Meena', 'student', 'school-demo');
  await mk('u-parent', 'parent@demo.kavli.local', 'Mr. Kumar', 'parent', null);
  await mk('u-teacher', 'teacher@demo.kavli.local', 'Ms. Priya', 'teacher', 'school-demo');
  await mk('u-school', 'school@demo.kavli.local', 'School Admin', 'school_admin', 'school-demo');
  await mk('u-admin', 'admin@demo.kavli.local', 'Platform Admin', 'admin', null);
  const prof = async (id: string, full: string, ta: string | null, cls: number, medium = 'English', lang = 'both') => (await q.run(db, 'INSERT INTO student_profiles(user_id,ref_no,full_name,full_name_ta,class_level,medium,ai_lang,academic_year,school_name,subjects,goals,guardian_approved,school_managed,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, readableId('KM'), full, ta, cls, medium, lang, ay, 'Demo Government Higher Secondary School (sample)', JSON.stringify(['maths', 'science', 'english', 'social', 'tamil']), JSON.stringify(['understand', 'exams']), 1, 1, ts, ts));
  await prof('u-student', 'Meenakshi Kumar', 'மீனாட்சி குமார்', 8);
  for (const [id, n] of [['u-arun', 'Arun Prakash'], ['u-divya', 'Divya Suresh'], ['u-karthik', 'Karthik Raja']]) { await mk(id, `${id.slice(2)}@demo.kavli.local`, n.split(' ')[0], 'student', 'school-demo'); await prof(id, n, null, 8); }
  await q.run(db, 'INSERT INTO guardian_links(parent_id,student_id) VALUES (?,?)', 'u-parent', 'u-student');
  await q.run(db, 'INSERT INTO classes VALUES (?,?,?,?,?,?)', 'cls-8a', 'school-demo', 'u-teacher', 'Class 8 · Section A', 8, ay);
  for (const s of ['u-student', 'u-arun', 'u-divya', 'u-karthik']) await q.run(db, 'INSERT INTO enrolments VALUES (?,?)', 'cls-8a', s);
  const board = 'Tamil Nadu State Board (Samacheer Kalvi)';
  const T2 = async (id: string, title: string, subj: string, wk: number, open: string, close: string, dur: number | null, pass: number, maxAtt: number, qs: [string, number][], topics: string[]) => {
    await q.run(db, 'INSERT INTO tests(id,title,description,class_level,board,subject_id,academic_year,topics,week_no,opens_at,closes_at,duration_min,language,instructions,pass_pct,max_attempts,score_rule,show_review,awards_certificate,allow_change_answers,auto_submit,published,created_by,school_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, title, 'Weekly test (sample questions written for this prototype).', 8, board, subj, ay, JSON.stringify(topics), wk, open, close, dur, 'both', 'Read each question carefully. You may change answers before you submit. Answers are saved automatically.', pass, maxAtt, 'highest', 1, 1, 1, 1, 1, 'u-teacher', 'school-demo', ts);
    qs.forEach(async ([qid, m], i) => (await q.run(db, 'INSERT INTO test_questions VALUES (?,?,?,?,?)', id, qid, m, i + 1, 1)));
  };
  if (!bookOnly()) {
  await T2('test-maths-w6', 'Mathematics — Weekly Test 6', 'maths', 6, at(-2), at(5), 45, 40, 2, [['t-m1', 6], ['t-m2', 6], ['t-m3', 6], ['t-m4', 4], ['t-m5', 6], ['t-m6', 8], ['t-m7', 8], ['t-m8', 6]], ['Equations']);
  // total 50: 6+6+6+4+6+8+8+6 = 50
  await T2('test-maths-w7', 'Mathematics — Weekly Test 7 (written answer)', 'maths', 7, at(-1), at(6), 45, 40, 2, [['t-m1', 6], ['t-m2', 6], ['t-m5', 6], ['t-m6', 8], ['t-m8', 6], ['t-m9', 18]], ['Equations', 'Word problems']);
  await T2('test-science-w6', 'Science — Weekly Test 6', 'science', 6, at(-1), at(4), 30, 40, 1, [['t-s1', 10], ['t-s2', 10], ['t-s3', 10], ['t-s4', 20]], ['Force and pressure']);
  await T2('test-english-w6', 'English — Weekly Test 6', 'english', 6, at(-1), at(3), 20, 40, 1, [['t-e1', 10], ['t-e2', 10], ['t-e3', 10], ['t-e4', 20]], ['Nouns']);
  await T2('test-social-w8', 'Social Science — Weekly Test 8', 'social', 8, at(2), at(9), 30, 40, 1, [['t-so1', 10], ['t-so2', 20], ['t-so3', 10]], ['Directions', 'Scale']);
  await T2('test-science-w5', 'Science — Weekly Test 5', 'science', 5, at(-9), at(-2), 30, 40, 1, [['t-s1', 10], ['t-s2', 10], ['t-s3', 10], ['t-s4', 20]], ['Force']);
  await q.run(db, 'INSERT INTO assignments VALUES (?,?,?,?,?,?,?)', 'as-1', 'cls-8a', 'Homework: 5 linear equations', 'Solve the 5 equations on page 12 and write each step. Photograph or type your working.', at(3), 'u-teacher', ts);
  await q.run(db, 'INSERT INTO notifications VALUES (?,?,?,?,0,?)', uid(), 'u-student', 'Weekly Test 6 is open', 'Mathematics — Weekly Test 6 closes in 5 days.', ts);
  }
  await q.run(db, 'INSERT INTO settings VALUES (?,?)', 'ai_daily_limit', '200');
}
