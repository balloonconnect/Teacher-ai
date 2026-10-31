// Deterministic maths helper for the development tutor: solves one-variable linear equations step by step, bilingual.
export type Frac = { n: number; d: number };
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const F = (n: number, d = 1): Frac => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; return { n: n / g, d: d / g }; };
const add = (x: Frac, y: Frac) => F(x.n * y.d + y.n * x.d, x.d * y.d);
const sub = (x: Frac, y: Frac) => F(x.n * y.d - y.n * x.d, x.d * y.d);
const mul = (x: Frac, y: Frac) => F(x.n * y.n, x.d * y.d);
const div = (x: Frac, y: Frac) => F(x.n * y.d, x.d * y.n);
const isZero = (x: Frac) => x.n === 0; const isInt = (x: Frac) => x.d === 1;
export const fstr = (x: Frac) => (isInt(x) ? String(x.n) : `${x.n}/${x.d}`);
const dec = (x: Frac) => (isInt(x) ? String(x.n) : `${x.n}/${x.d} (≈ ${(x.n / x.d).toFixed(2)})`);
type Lin = { a: Frac; b: Frac }; // a·x + b

export function fmtLin(l: Lin, v = 'x'): string {
  const parts: string[] = [];
  if (!isZero(l.a)) { const abs = F(Math.abs(l.a.n), l.a.d); const co = abs.n === 1 && abs.d === 1 ? '' : fstr(abs); parts.push(`${l.a.n < 0 ? '-' : ''}${co}${v}`); }
  if (!isZero(l.b) || !parts.length) { const s = fstr(F(Math.abs(l.b.n), l.b.d)); parts.push(parts.length ? `${l.b.n < 0 ? '-' : '+'} ${s}` : `${l.b.n < 0 ? '-' : ''}${s}`); }
  return parts.join(' ').replace(/^(-)(\S)/, '-$2').replace(/ \+ -/g, ' - ');
}
type Tok = { t: 'num' | 'var' | 'op' | '(' | ')'; v: string };
function tokenize(s: string): Tok[] {
  const out: Tok[] = []; const src = s.replace(/[×·]/g, '*').replace(/[−–]/g, '-').replace(/÷/g, '/').replace(/\s+/g, '');
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (/[0-9.]/.test(c)) { let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++; out.push({ t: 'num', v: src.slice(i, j) }); i = j; }
    else if (/[a-zA-Z]/.test(c)) { out.push({ t: 'var', v: c.toLowerCase() }); i++; }
    else if ('+-*/'.includes(c)) { out.push({ t: 'op', v: c }); i++; }
    else if (c === '(') { out.push({ t: '(', v: c }); i++; } else if (c === ')') { out.push({ t: ')', v: c }); i++; }
    else throw new Error('char');
  }
  return out;
}
function parseNum(s: string): Frac { if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('num'); const [i, f = ''] = s.split('.'); return F(Number(i + f), 10 ** f.length); }
class P {
  i = 0; varName: string | null = null;
  constructor(public t: Tok[]) {}
  peek() { return this.t[this.i]; }
  expr(): Lin { let l = this.term(); while (this.peek()?.t === 'op' && '+-'.includes(this.peek().v)) { const o = this.t[this.i++].v; const r = this.term(); l = o === '+' ? { a: add(l.a, r.a), b: add(l.b, r.b) } : { a: sub(l.a, r.a), b: sub(l.b, r.b) }; } return l; }
  term(): Lin {
    let l = this.unary();
    for (;;) {
      const p = this.peek(); if (!p) break;
      if (p.t === 'op' && '*/'.includes(p.v)) { this.i++; const r = this.unary(); l = p.v === '*' ? this.mul(l, r) : this.divide(l, r); }
      else if (p.t === 'var' || p.t === '(' || p.t === 'num') { const r = this.unary(); l = this.mul(l, r); } // implicit multiplication: 3x, 2(x-1)
      else break;
    }
    return l;
  }
  mul(l: Lin, r: Lin): Lin { if (!isZero(l.a) && !isZero(r.a)) throw new Error('nonlinear'); return { a: add(mul(l.a, r.b), mul(r.a, l.b)), b: mul(l.b, r.b) }; }
  divide(l: Lin, r: Lin): Lin { if (!isZero(r.a) || isZero(r.b)) throw new Error('div'); return { a: div(l.a, r.b), b: div(l.b, r.b) }; }
  unary(): Lin { const p = this.peek(); if (p?.t === 'op' && (p.v === '-' || p.v === '+')) { this.i++; const x = this.unary(); return p.v === '-' ? { a: F(-x.a.n, x.a.d), b: F(-x.b.n, x.b.d) } : x; } return this.atom(); }
  atom(): Lin {
    const p = this.t[this.i++]; if (!p) throw new Error('eof');
    if (p.t === 'num') return { a: F(0), b: parseNum(p.v) };
    if (p.t === 'var') { if (this.varName && this.varName !== p.v) throw new Error('multivar'); this.varName = p.v; return { a: F(1), b: F(0) }; }
    if (p.t === '(') { const e = this.expr(); if (this.t[this.i++]?.t !== ')') throw new Error('paren'); return e; }
    throw new Error('atom');
  }
}
function parseSide(s: string, varRef: { v: string | null }): Lin { const p = new P(tokenize(s)); p.varName = varRef.v; const r = p.expr(); if (p.i < p.t.length) throw new Error('trailing'); varRef.v = p.varName; return r; }
export function evalConst(s: string): Frac | null { try { const l = parseSide(s, { v: null }); return isZero(l.a) ? l.b : null; } catch { return null; } }

export type Step = { en: string; ta: string };
export type Solution = { kind: 'solution'; x: Frac | null; variable: string; steps: Step[]; summary: Step; lhsStr: string; rhsStr: string; a?: Frac; b?: Frac; c?: Frac; d?: Frac } ;
const hasParen = (s: string) => /[()]/.test(s);

/** Find and solve a linear equation inside free text. Returns null when no solvable equation is present. */
export function solveLinearFromText(text: string): Solution | null {
  const m = text.match(/([0-9a-zA-Z.()+\-−–*×·/÷\s]+=[0-9a-zA-Z.()+\-−–*×·/÷\s]+)/);
  if (!m) return null; let eq = m[1].trim();
  // trim leading words (e.g. "solve", "x is") that got captured as variables
  eq = eq.replace(/^[a-zA-Z]{2,}\s+/, '').trim();
  const [L, R] = eq.split('='); if (!L || !R || eq.split('=').length !== 2) return null;
  const ref = { v: null as string | null };
  try {
    const l = parseSide(L, ref), r = parseSide(R, ref); const v = ref.v ?? 'x';
    const steps: Step[] = []; const lhsStr = L.trim(), rhsStr = R.trim();
    steps.push({ en: `Start with the equation: ${lhsStr} = ${rhsStr}`, ta: `சமன்பாட்டுடன் தொடங்குவோம்: ${lhsStr} = ${rhsStr}` });
    if (hasParen(L) || hasParen(R)) steps.push({ en: `Expand the brackets and simplify each side: ${fmtLin(l, v)} = ${fmtLin(r, v)}`, ta: `அடைப்புக்குறிகளை விரித்து இரு பக்கங்களையும் எளிமைப்படுத்துக: ${fmtLin(l, v)} = ${fmtLin(r, v)}` });
    const A = sub(l.a, r.a), B = sub(r.b, l.b);
    if (!isZero(r.a)) steps.push({ en: `Move the ${v} terms to the left and the numbers to the right (do the same to both sides): ${fmtLin({ a: A, b: F(0) }, v)} = ${fstr(B)}`, ta: `${v} உறுப்புகளை இடப்புறமும் எண்களை வலப்புறமும் கொண்டு வருக (இரு பக்கமும் ஒரே செயல்): ${fmtLin({ a: A, b: F(0) }, v)} = ${fstr(B)}` });
    else if (!isZero(l.b)) steps.push({ en: `${l.b.n > 0 ? 'Subtract' : 'Add'} ${fstr(F(Math.abs(l.b.n), l.b.d))} ${l.b.n > 0 ? 'from' : 'to'} both sides: ${fmtLin({ a: A, b: F(0) }, v)} = ${fstr(B)}`, ta: `இரு பக்கமும் ${fstr(F(Math.abs(l.b.n), l.b.d))} ஐ${l.b.n > 0 ? ' கழிக்க' : ' கூட்ட'}: ${fmtLin({ a: A, b: F(0) }, v)} = ${fstr(B)}` });
    if (isZero(A)) {
      const ok = isZero(B);
      return { kind: 'solution', x: null, variable: v, steps: [...steps, ok ? { en: 'Both sides are always equal, so every value works (infinitely many solutions).', ta: 'இரு பக்கங்களும் எப்போதும் சமம்; எனவே எந்த மதிப்பும் பொருந்தும் (எண்ணற்ற தீர்வுகள்).' } : { en: 'The sides can never be equal, so there is no solution.', ta: 'இரு பக்கங்களும் ஒருபோதும் சமமாகாது; எனவே தீர்வு இல்லை.' }], summary: ok ? { en: 'Infinitely many solutions.', ta: 'எண்ணற்ற தீர்வுகள்.' } : { en: 'No solution.', ta: 'தீர்வு இல்லை.' }, lhsStr, rhsStr };
    }
    const x = div(B, A);
    if (!(isInt(A) && A.n === 1)) steps.push({ en: `Divide both sides by ${fstr(A)}: ${v} = ${dec(x)}`, ta: `இரு பக்கமும் ${fstr(A)} ஆல் வகுக்க: ${v} = ${dec(x)}` });
    const lv = add(mul(l.a, x), l.b), rv = add(mul(r.a, x), r.b);
    steps.push({ en: `Check: put ${v} = ${fstr(x)} back. Left side = ${fstr(lv)}, right side = ${fstr(rv)} ${isZero(sub(lv, rv)) ? '✓' : '✗'}`, ta: `சரிபார்க்க: ${v} = ${fstr(x)} ஐப் பிரதியிட்டால் இடப்புறம் = ${fstr(lv)}, வலப்புறம் = ${fstr(rv)} ${isZero(sub(lv, rv)) ? '✓' : '✗'}` });
    return { kind: 'solution', x, variable: v, steps, summary: { en: `${v} = ${dec(x)}`, ta: `${v} = ${dec(x)}` }, lhsStr, rhsStr, a: l.a, b: l.b, c: r.a, d: r.b };
  } catch { return null; }
}
export const toNumber = (f: Frac) => f.n / f.d;
