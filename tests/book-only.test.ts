import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers';
import { q } from '../server/db';
import { purgeSampleContent } from '../server/bookOnly';

let db: Awaited<ReturnType<typeof setup>>['db'];
const n = async (s: string) => (await q.get<any>(db, s))!.n;
beforeEach(async () => { ({ db } = await setup()); });
afterEach(() => { delete process.env.BOOK_ONLY; });

describe('book-only mode', () => {
  it('the normal demo database has sample lessons and tests', async () => {
    expect(await n("SELECT COUNT(*) n FROM lessons WHERE source NOT LIKE 'Textbook:%'")).toBeGreaterThan(0);
    expect(await n('SELECT COUNT(*) n FROM tests')).toBeGreaterThan(0);
  });
  it('purge removes sample content but keeps book lessons, users and the class', async () => {
    await q.run(db, "INSERT INTO lessons(id,class_level,subject_id,term,chapter_no,chapter_en,chapter_ta,title_en,title_ta,minutes,position,content,source,version,status) VALUES ('bk-test0001-1',8,'tamil',1,1,'a','a','a','a',5,1,'{}','Textbook: Class 8 Tamil, pages 1–2.',1,'published')");
    await purgeSampleContent(db);
    expect(await n("SELECT COUNT(*) n FROM lessons WHERE id NOT LIKE 'bk-%'")).toBe(0);
    expect(await n("SELECT COUNT(*) n FROM lessons WHERE id='bk-test0001-1'")).toBe(1);
    expect(await n('SELECT COUNT(*) n FROM tests')).toBe(0);
    expect(await n("SELECT COUNT(*) n FROM questions WHERE origin='practice'")).toBe(0);
    expect(await n('SELECT COUNT(*) n FROM assignments')).toBe(0);
    expect(await n('SELECT COUNT(*) n FROM users')).toBeGreaterThan(0);
    await purgeSampleContent(db); // safe to repeat
  });
});

describe('textbook medium "Both"', () => {
  it('reads with Tamil and English text recognition and accepts either language per page', async () => {
    const { langFor } = await import('../server/services/textbookIngest');
    const { textQuality } = await import('../server/services/ocr');
    expect(langFor('Both')).toBe('tam+eng'); expect(langFor('English')).toBe('eng');
    expect(textQuality('The students read the lesson and then they answer the questions in the book with the teacher.', 'Both').ok).toBe(true);
    expect(textQuality('அறம் என்பது நல்ல செயல்களைச் செய்வதாகும் என்று வள்ளுவர் கூறுகிறார் அதனால் நாம் அதைப் பின்பற்ற வேண்டும்', 'Both').ok).toBe(true);
  });
});

describe('subject from the title', () => {
  it('fills a blank subject only when the title names exactly one', async () => {
    const { guessSubject } = await import('../server/routes/textbooks');
    expect(guessSubject('Class 8 English')).toBe('english'); expect(guessSubject('Class 8 Tamil — Term 1')).toBe('tamil'); expect(guessSubject('Class 8 Mathematics')).toBe('maths');
    expect(guessSubject('English and Tamil reader')).toBeNull(); expect(guessSubject('Class 8 Term 1')).toBeNull();
  });
});
