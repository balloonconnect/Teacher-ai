/* Lists English strings in the student-facing source (JSX text, attributes, toasts, notices) that have no Tamil translation yet.
 * Usage: npx tsx scripts/ta-strings.ts [--all] [files…]   (default: the student-facing pages and components) */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { translate } from '../src/i18n/translate';

const root = path.resolve(import.meta.dirname, '..');
const DEFAULT = ['src/pages/student.tsx', 'src/pages/tutor.tsx', 'src/pages/voice.tsx', 'src/pages/material.tsx', 'src/pages/tests.tsx', 'src/pages/certs.tsx', 'src/pages/books.tsx', 'src/pages/public.tsx', 'src/pages/signup.tsx', 'src/pages/account.tsx', 'src/pages/profile.tsx', 'src/pages/parent.tsx', 'src/App.tsx', 'src/components'];
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const files: string[] = [];
const add = (p: string) => { const f = path.resolve(root, p); if (!fs.existsSync(f)) return; if (fs.statSync(f).isDirectory()) fs.readdirSync(f).forEach(n => add(path.join(p, n))); else if (/\.tsx?$/.test(f) && !/i18n/.test(f)) files.push(f); };
(args.length ? args : DEFAULT).forEach(add);

const NOISE = /(?:\d+px |Noto Sans|^\/\w|^[\w-]+\/[\w.-]+$)/;
const ALLOW = /^(?:[A-Z]{2,}[a-z]*\d*|https?:.*|[\w.+-]+@[\w.-]+|\w+\/\w+.*)$/;
const missing = new Map<string, string>();
for (const f of files) {
  const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n: ts.Node) => {
    let text: string | null = null;
    if (ts.isJsxText(n)) text = n.text;
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      const inImport = ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || (ts.isLiteralTypeNode(p));
      const isJsxAttr = ts.isJsxAttribute(p) && !/^(placeholder|aria-label|title|alt|label)$/.test(p.name.getText());
      const isProp = ts.isPropertyAssignment(p) && p.name === n || ts.isElementAccessExpression(p) || ts.isCaseClause(p) || (ts.isBinaryExpression(p) && /^[=!]=/.test(p.operatorToken.getText()));
      if (!inImport && !isJsxAttr && !isProp) text = n.text;
    }
    if (text) {
      const t = text.replace(/\s+/g, ' ').trim();
      if (/[A-Za-z]{3,}/.test(t) && /[A-Za-z]{2,}[ ,.!?’']+[A-Za-z]{2,}|^[A-Z][a-z]{2,}\b/.test(t) && !ALLOW.test(t) && !NOISE.test(t) && !/^[\w-]+(\.[\w-]+)*$/.test(t) && !/[{}=;()<>]/.test(t.replace(/\(.*?\)/g, ''))) {
        if (translate(t) === null) missing.set(t, `${path.relative(root, f)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
for (const [t, where] of [...missing].sort()) console.log(`${where}\t${t}`);
console.error(`${missing.size} untranslated strings in ${files.length} files`);
if (process.argv.includes('--check') && missing.size) process.exit(1);
