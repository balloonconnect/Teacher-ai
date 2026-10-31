import { readdirSync, readFileSync } from 'node:fs';
import { DB, q } from './db';

const DIR = new URL('./curriculum/', import.meta.url);
type TextbookLesson = { id: string; class_level: number; subject_id: string; chapter_no: number; chapter_en: string; chapter_ta: string; title_en: string; title_ta: string; minutes: number; position: number; source: string; content: any };

/** Textbook-derived lesson excerpts produced by scripts/import-textbook.ts (server/curriculum/*.json). */
export function textbookLessons(): TextbookLesson[] {
  const out: TextbookLesson[] = [];
  for (const f of readdirSync(DIR).filter(x => x.endsWith('.json')).sort()) {
    const d = JSON.parse(readFileSync(new URL(f, DIR), 'utf8')); for (const l of d.lessons ?? []) out.push(l);
  }
  return out;
}
/** Adds or refreshes textbook lessons without touching student data; safe to run on every start. */
export async function upsertTextbookLessons(db: DB): Promise<number> {
  let n = 0;
  for (const l of textbookLessons()) {
    if (!(await q.get(db, 'SELECT 1 FROM subjects WHERE id=?', l.subject_id))) continue;
    await q.run(db, `INSERT INTO lessons(id,class_level,subject_id,term,chapter_no,chapter_en,chapter_ta,title_en,title_ta,minutes,position,content,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET chapter_en=excluded.chapter_en, chapter_ta=excluded.chapter_ta, title_en=excluded.title_en, title_ta=excluded.title_ta, minutes=excluded.minutes, position=excluded.position, content=excluded.content, source=excluded.source`,
      l.id, l.class_level, l.subject_id, 1, l.chapter_no, l.chapter_en, l.chapter_ta, l.title_en, l.title_ta, l.minutes, l.position, JSON.stringify(l.content), l.source);
    n++;
  }
  return n;
}
