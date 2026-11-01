/**
 * Visual-learning service (pure code: no Node or browser APIs, so the server and the UI preview share it).
 *
 * Source priority implemented here: (3) original diagrams drawn in code as SVG. Textbook illustrations (1), licensed image
 * repositories (2) and AI-generated images (4) are NOT implemented — see ImageProvider in server/services/visuals.ts for the seam.
 * Nothing here fetches a network image, so there is nothing to hotlink and no licence to breach.
 */
export type Bi = { en: string; ta: string };
export type VId = 'heart' | 'reflection' | 'pythagoras' | 'balance' | 'graph';
/** Everything needed to redraw a diagram. `hl` highlights one part, `lvl` picks the simple variant, `p` carries numbers. */
export type VKey = { id: VId; hl?: string; lvl?: 'full' | 'simple'; p?: string };
export type VLabel = { id: string; name: Bi; meaning: Bi };
export type Visual = {
  key: VKey; topic: Bi; step?: number; title: Bi; caption: Bi; alt: Bi; labels: VLabel[];
  source: string; attribution: string; license: string; kind: 'original-svg'; score: number; reviewed: boolean;
};
export type Lng = 'en' | 'ta' | 'both';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const BLUE = '#2563eb', RED = '#dc2626', INK = '#1f2937', MUTE = '#6b7280', HL = '#f59e0b', PURPLE = '#7c3aed';

/** Text block: English, Tamil, or both (Tamil smaller, under the English). */
function txt(x: number, y: number, b: Bi, lng: Lng, o: { size?: number; anchor?: 'start' | 'middle' | 'end'; fill?: string; weight?: number } = {}) {
  const s = o.size ?? 13, a = o.anchor ?? 'middle', f = o.fill ?? INK, w = o.weight ?? 600;
  const t = (y0: number, str: string, sz: number) => `<text x="${x}" y="${y0}" font-size="${sz}" font-weight="${w}" text-anchor="${a}" fill="${f}" font-family="Inter,'Noto Sans Tamil',system-ui,sans-serif">${esc(str)}</text>`;
  if (lng === 'en') return t(y, b.en, s); if (lng === 'ta') return t(y, b.ta, s);
  return t(y, b.en, s) + t(y + s + 1, b.ta, Math.round(s * 0.85));
}
const wrapSvg = (vb: string, body: string, title: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${esc(title)}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
const arrowDefs = (c: string, id: string) => `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`;

/* ---------------- Heart (schematic of the four chambers and blood flow) ---------------- */
const HEART: VLabel[] = [
  { id: 'vena-cava', name: { en: 'Vena cava', ta: 'பெருஞ்சிரை' }, meaning: { en: 'The large veins that bring oxygen-poor blood from the body to the right atrium.', ta: 'உடலிலிருந்து ஆக்சிஜன் குறைந்த இரத்தத்தை வலது ஆரிக்கிளுக்குக் கொண்டுவரும் பெரிய சிரைகள்.' } },
  { id: 'ra', name: { en: 'Right atrium', ta: 'வலது ஆரிக்கிள்' }, meaning: { en: 'Receives oxygen-poor blood from the body and passes it to the right ventricle.', ta: 'உடலிலிருந்து வரும் ஆக்சிஜன் குறைந்த இரத்தத்தைப் பெற்று வலது வென்ட்ரிக்கிளுக்கு அனுப்பும்.' } },
  { id: 'rv', name: { en: 'Right ventricle', ta: 'வலது வென்ட்ரிக்கிள்' }, meaning: { en: 'Pumps oxygen-poor blood to the lungs through the pulmonary artery.', ta: 'ஆக்சிஜன் குறைந்த இரத்தத்தை நுரையீரல் தமனி வழியாக நுரையீரலுக்கு உந்தும்.' } },
  { id: 'pulm-artery', name: { en: 'Pulmonary artery', ta: 'நுரையீரல் தமனி' }, meaning: { en: 'Carries oxygen-poor blood from the right ventricle to the lungs.', ta: 'வலது வென்ட்ரிக்கிளிலிருந்து நுரையீரலுக்கு ஆக்சிஜன் குறைந்த இரத்தத்தைக் கொண்டு செல்லும்.' } },
  { id: 'lungs', name: { en: 'Lungs', ta: 'நுரையீரல்' }, meaning: { en: 'Blood picks up oxygen here and gives out carbon dioxide.', ta: 'இங்கு இரத்தம் ஆக்சிஜனைப் பெற்று கார்பன் டை ஆக்சைடை வெளியேற்றும்.' } },
  { id: 'pulm-veins', name: { en: 'Pulmonary veins', ta: 'நுரையீரல் சிரைகள்' }, meaning: { en: 'Bring oxygen-rich blood from the lungs to the left atrium.', ta: 'நுரையீரலிலிருந்து ஆக்சிஜன் நிறைந்த இரத்தத்தை இடது ஆரிக்கிளுக்குக் கொண்டுவரும்.' } },
  { id: 'la', name: { en: 'Left atrium', ta: 'இடது ஆரிக்கிள்' }, meaning: { en: 'Receives oxygen-rich blood from the lungs and passes it to the left ventricle.', ta: 'நுரையீரலிலிருந்து ஆக்சிஜன் நிறைந்த இரத்தத்தைப் பெற்று இடது வென்ட்ரிக்கிளுக்கு அனுப்பும்.' } },
  { id: 'lv', name: { en: 'Left ventricle', ta: 'இடது வென்ட்ரிக்கிள்' }, meaning: { en: 'The strongest chamber: pumps oxygen-rich blood into the aorta for the whole body.', ta: 'வலிமையான அறை: ஆக்சிஜன் நிறைந்த இரத்தத்தை பெருந்தமனி வழியாக உடல் முழுவதும் உந்தும்.' } },
  { id: 'aorta', name: { en: 'Aorta', ta: 'பெருந்தமனி' }, meaning: { en: 'The main artery that carries oxygen-rich blood from the left ventricle to the body.', ta: 'இடது வென்ட்ரிக்கிளிலிருந்து உடலுக்கு ஆக்சிஜன் நிறைந்த இரத்தத்தைக் கொண்டு செல்லும் முதன்மைத் தமனி.' } },
];
function heart(k: VKey, g: Lng) {
  const hl = k.hl, simple = k.lvl === 'simple', L = (id: string) => HEART.find(x => x.id === id)!.name;
  const op = (id: string) => (hl && hl !== id ? 0.3 : 1); const ring = (id: string) => (hl === id ? ` stroke="${HL}" stroke-width="5"` : '');
  const box = (id: string, x: number, y: number, w: number, h: number, c: string) => `<g opacity="${op(id)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-width="2.5"${hl === id ? ` style="stroke:${HL};stroke-width:5"` : ''}/>${txt(x + w / 2, y + h / 2 - (g === 'both' ? 2 : -4), L(id), g, { size: 14 })}</g>`;
  const arrow = (id: string, d: string, c: string) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="4" marker-end="url(#a${c.slice(1)})" opacity="${op(id)}"${ring(id)}/>`;
  const lab = (id: string, x: number, y: number, a: 'start' | 'middle' | 'end' = 'middle', c = INK) => `<g opacity="${op(id)}">${txt(x, y, L(id), g, { size: 12, anchor: a, fill: c, weight: 500 })}</g>`;
  let b = `<defs>${arrowDefs(BLUE, 'a' + BLUE.slice(1))}${arrowDefs(RED, 'a' + RED.slice(1))}</defs>`;
  b += arrow('vena-cava', 'M105 62 L105 108', BLUE) + lab('vena-cava', 105, 36, 'middle', BLUE);
  b += box('ra', 40, 110, 130, 80, BLUE) + box('rv', 40, 235, 130, 85, BLUE) + box('la', 350, 110, 130, 80, RED) + box('lv', 350, 235, 130, 85, RED);
  b += arrow('ra', 'M105 192 L105 233', BLUE) + arrow('la', 'M415 192 L415 233', RED);
  b += `<g opacity="${op('lungs')}"><rect x="205" y="115" width="110" height="70" rx="35" fill="${PURPLE}" fill-opacity="0.14" stroke="${hl === 'lungs' ? HL : PURPLE}" stroke-width="${hl === 'lungs' ? 5 : 2.5}"/>${txt(260, 155, L('lungs'), g, { size: 14 })}</g>`;
  b += arrow('pulm-artery', 'M172 285 L260 285 L260 187', BLUE) + arrow('pulm-veins', 'M317 150 L348 150', RED);
  if (!simple) b += lab('pulm-artery', 215, 306, 'middle', BLUE) + lab('pulm-veins', 333, 86, 'middle', RED);
  b += arrow('aorta', 'M415 322 L415 358', RED) + lab('aorta', 415, 376, 'middle', RED);
  b += `<g font-size="11" fill="${MUTE}" font-family="Inter,sans-serif"><rect x="40" y="350" width="12" height="12" fill="${BLUE}" fill-opacity=".5"/><text x="58" y="361">${g === 'ta' ? 'ஆக்சிஜன் குறைந்த இரத்தம்' : 'Oxygen-poor blood'}</text><rect x="40" y="368" width="12" height="12" fill="${RED}" fill-opacity=".5"/><text x="58" y="379">${g === 'ta' ? 'ஆக்சிஜன் நிறைந்த இரத்தம்' : 'Oxygen-rich blood'}</text></g>`;
  return wrapSvg('0 0 520 400', b, 'Heart chambers and blood flow');
}

/* ---------------- Reflection of light (law of reflection) ---------------- */
export const REFLECT_DEG = 40;
export function reflectionPoints(deg = REFLECT_DEG) { const r = (deg * Math.PI) / 180, O = { x: 260, y: 250 }, L = 190; return { O, inc: { x: O.x - L * Math.sin(r), y: O.y - L * Math.cos(r) }, ref: { x: O.x + L * Math.sin(r), y: O.y - L * Math.cos(r) } }; }
const REFL: VLabel[] = [
  { id: 'incident', name: { en: 'Incident ray', ta: 'படுகதிர்' }, meaning: { en: 'The ray of light that travels towards the mirror.', ta: 'ஆடியை நோக்கி வரும் ஒளிக்கதிர்.' } },
  { id: 'reflected', name: { en: 'Reflected ray', ta: 'எதிரொளிப்புக் கதிர்' }, meaning: { en: 'The ray that bounces back from the mirror.', ta: 'ஆடியிலிருந்து திரும்பிச் செல்லும் கதிர்.' } },
  { id: 'normal', name: { en: 'Normal', ta: 'செங்குத்துக்கோடு' }, meaning: { en: 'A line drawn at 90° to the mirror at the point where the ray hits. Angles are measured from it.', ta: 'கதிர் விழும் புள்ளியில் ஆடிக்குச் செங்குத்தாக வரையப்படும் கோடு; கோணங்கள் இதிலிருந்து அளக்கப்படும்.' } },
  { id: 'mirror', name: { en: 'Plane mirror', ta: 'சமதள ஆடி' }, meaning: { en: 'A flat, smooth reflecting surface.', ta: 'தட்டையான, வழவழப்பான எதிரொளிக்கும் பரப்பு.' } },
  { id: 'angles', name: { en: 'Angle i and angle r', ta: 'கோணம் i மற்றும் r' }, meaning: { en: 'i is the angle of incidence and r is the angle of reflection. The law of reflection says i = r.', ta: 'i என்பது படுகோணம், r என்பது எதிரொளிப்புக் கோணம். எதிரொளிப்பு விதிப்படி i = r.' } },
];
function reflection(k: VKey, g: Lng) {
  const { O, inc, ref } = reflectionPoints(), hl = k.hl, simple = k.lvl === 'simple'; const op = (id: string) => (hl && hl !== id ? 0.3 : 1); const col = (id: string, c: string) => (hl === id ? HL : c);
  const N = (id: string) => REFL.find(x => x.id === id)!.name; const R = 62; const a = (deg: number, sign: 1 | -1) => ({ x: O.x + sign * R * Math.sin((deg * Math.PI) / 180), y: O.y - R * Math.cos((deg * Math.PI) / 180) });
  const pi = a(REFLECT_DEG, -1), pr = a(REFLECT_DEG, 1);
  let b = `<defs>${arrowDefs('#ea580c', 'ai')}${arrowDefs(PURPLE, 'ar')}</defs>`;
  b += `<g opacity="${op('mirror')}"><line x1="70" y1="250" x2="450" y2="250" stroke="${col('mirror', INK)}" stroke-width="5"/>${Array.from({ length: 19 }, (_, i) => `<line x1="${78 + i * 20}" y1="252" x2="${70 + i * 20}" y2="268" stroke="${MUTE}" stroke-width="2"/>`).join('')}</g>`;
  b += `<g opacity="${op('normal')}"><line x1="260" y1="55" x2="260" y2="250" stroke="${col('normal', MUTE)}" stroke-width="2.5" stroke-dasharray="7 6"/></g>`;
  b += `<g opacity="${op('incident')}"><line x1="${inc.x}" y1="${inc.y}" x2="${O.x}" y2="${O.y - 3}" stroke="${col('incident', '#ea580c')}" stroke-width="4.5" marker-end="url(#ai)"/></g>`;
  b += `<g opacity="${op('reflected')}"><line x1="${O.x}" y1="${O.y}" x2="${ref.x}" y2="${ref.y}" stroke="${col('reflected', PURPLE)}" stroke-width="4.5" marker-end="url(#ar)"/></g>`;
  b += `<circle cx="${O.x}" cy="${O.y}" r="4.5" fill="${INK}"/>`;
  if (!simple) b += `<g opacity="${op('angles')}"><path d="M260 ${O.y - R} A${R} ${R} 0 0 0 ${pi.x} ${pi.y}" fill="none" stroke="${col('angles', '#ea580c')}" stroke-width="3"/><path d="M260 ${O.y - R} A${R} ${R} 0 0 1 ${pr.x} ${pr.y}" fill="none" stroke="${col('angles', PURPLE)}" stroke-width="3"/><text x="${O.x - 44}" y="${O.y - 72}" font-size="17" font-style="italic" font-weight="700" fill="#ea580c" text-anchor="middle" font-family="Inter,sans-serif">i</text><text x="${O.x + 44}" y="${O.y - 72}" font-size="17" font-style="italic" font-weight="700" fill="${PURPLE}" text-anchor="middle" font-family="Inter,sans-serif">r</text></g>`;
  b += `<g opacity="${op('incident')}">${txt(inc.x - 10, inc.y - 14, N('incident'), g, { anchor: 'middle', fill: '#c2410c' })}</g><g opacity="${op('reflected')}">${txt(ref.x + 10, ref.y - 14, N('reflected'), g, { fill: PURPLE })}</g><g opacity="${op('normal')}">${txt(260, 44, N('normal'), g, { fill: MUTE })}</g><g opacity="${op('mirror')}">${txt(260, 298, N('mirror'), g, {})}</g>`;
  if (!simple) b += `<text x="260" y="326" text-anchor="middle" font-size="13" fill="${INK}" font-family="Inter,sans-serif" font-weight="600">i = r</text>`;
  return wrapSvg('0 0 520 340', b, 'Reflection of light from a plane mirror');
}

/* ---------------- Right triangle (Pythagoras 3-4-5) ---------------- */
const PYTH: VLabel[] = [
  { id: 'hypotenuse', name: { en: 'Hypotenuse (c)', ta: 'கர்ணம் (c)' }, meaning: { en: 'The longest side, opposite the right angle.', ta: 'செங்கோணத்திற்கு எதிரில் உள்ள மிக நீளமான பக்கம்.' } },
  { id: 'legs', name: { en: 'Legs (a and b)', ta: 'செங்கோணப் பக்கங்கள் (a, b)' }, meaning: { en: 'The two sides that meet at the right angle.', ta: 'செங்கோணத்தில் சந்திக்கும் இரு பக்கங்கள்.' } },
  { id: 'right-angle', name: { en: 'Right angle (90°)', ta: 'செங்கோணம் (90°)' }, meaning: { en: 'The corner that measures exactly 90°.', ta: 'சரியாக 90° அளவுள்ள மூலை.' } },
];
function pythagoras(k: VKey, g: Lng) {
  const hl = k.hl, op = (id: string) => (hl && hl !== id ? 0.3 : 1); const C = { x: 130, y: 250 }, B = { x: 330, y: 250 }, A = { x: 130, y: 100 }; const N = (id: string) => PYTH.find(x => x.id === id)!.name;
  let b = `<polygon points="${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}" fill="${BLUE}" fill-opacity="0.08" stroke="${INK}" stroke-width="3"/>`;
  b += `<g opacity="${op('hypotenuse')}"><line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${hl === 'hypotenuse' ? HL : RED}" stroke-width="5"/>${txt(250, 150, N('hypotenuse'), g, { anchor: 'start', fill: RED })}<text x="250" y="${g === 'both' ? 186 : 170}" font-size="12" fill="${MUTE}" font-family="Inter,sans-serif">c = 5</text></g>`;
  b += `<g opacity="${op('legs')}"><line x1="${C.x}" y1="${C.y}" x2="${B.x}" y2="${B.y}" stroke="${hl === 'legs' ? HL : BLUE}" stroke-width="5"/><line x1="${A.x}" y1="${A.y}" x2="${C.x}" y2="${C.y}" stroke="${hl === 'legs' ? HL : BLUE}" stroke-width="5"/><text x="230" y="278" text-anchor="middle" font-size="14" font-weight="600" fill="${BLUE}" font-family="Inter,sans-serif">b = 4</text><text x="108" y="180" text-anchor="end" font-size="14" font-weight="600" fill="${BLUE}" font-family="Inter,sans-serif">a = 3</text></g>`;
  b += `<g opacity="${op('right-angle')}"><path d="M${C.x} ${C.y - 22} L${C.x + 22} ${C.y - 22} L${C.x + 22} ${C.y}" fill="none" stroke="${hl === 'right-angle' ? HL : INK}" stroke-width="2.5"/>${txt(C.x + 60, C.y - 28, N('right-angle'), g, { size: 11, anchor: 'start', fill: MUTE, weight: 500 })}</g>`;
  b += `<text x="260" y="40" text-anchor="middle" font-size="16" font-weight="700" fill="${INK}" font-family="Inter,sans-serif">a² + b² = c²</text><text x="260" y="66" text-anchor="middle" font-size="14" fill="${MUTE}" font-family="Inter,sans-serif">3² + 4² = 9 + 16 = 25 = 5²</text>`;
  return wrapSvg('0 0 520 310', b, 'Right-angled triangle with sides 3, 4 and 5');
}

/* ---------------- Balance for an equation step ---------------- */
function balance(k: VKey, g: Lng) {
  const [l, r] = (k.p ?? '|').split('|'); const L = esc(l.slice(0, 18)), R = esc(r.slice(0, 18));
  const t = (x: number, s: string) => `<text x="${x}" y="150" text-anchor="middle" font-size="26" font-weight="700" fill="${INK}" font-family="Inter,sans-serif">${s}</text>`;
  let b = `<polygon points="260,250 230,285 290,285" fill="${MUTE}"/><rect x="254" y="86" width="12" height="164" fill="${MUTE}"/><rect x="70" y="84" width="380" height="9" rx="4" fill="${INK}"/>`;
  b += `<line x1="110" y1="93" x2="110" y2="118" stroke="${INK}" stroke-width="3"/><line x1="410" y1="93" x2="410" y2="118" stroke="${INK}" stroke-width="3"/>`;
  b += `<rect x="50" y="118" width="120" height="58" rx="10" fill="${BLUE}" fill-opacity=".12" stroke="${BLUE}" stroke-width="2.5"/><rect x="350" y="118" width="120" height="58" rx="10" fill="${RED}" fill-opacity=".12" stroke="${RED}" stroke-width="2.5"/>${t(110, L)}${t(410, R)}`;
  b += `<text x="260" y="66" text-anchor="middle" font-size="22" font-weight="700" fill="${INK}" font-family="Inter,sans-serif">=</text>`;
  b += txt(260, 316, { en: 'Both sides stay equal: do the same to each side.', ta: 'இரு பக்கமும் சமம்: இரு பக்கமும் ஒரே செயலைச் செய்யுங்கள்.' }, g, { size: 12, fill: MUTE, weight: 500 });
  return wrapSvg('0 0 520 345', b, `Balance showing ${l} equals ${r}`);
}

/* ---------------- Graph of y = m x + c ---------------- */
function graph(k: VKey, g: Lng) {
  const [ms, cs] = (k.p ?? '1|0').split('|'); const m = Math.max(-5, Math.min(5, Number(ms) || 0)), c = Math.max(-5, Math.min(5, Number(cs) || 0)); const S = 28, ox = 260, oy = 170;
  const X = (x: number) => ox + x * S, Y = (y: number) => oy - y * S; const clip = (x: number) => Math.max(-6, Math.min(6, m * x + c));
  const xs = [-5, 5].map(x => { const y = m * x + c; return y > 5.5 ? (5.5 - c) / (m || 1) : y < -5.5 ? (-5.5 - c) / (m || 1) : x; }); void clip;
  let b = `<g stroke="#e5e7eb" stroke-width="1">${Array.from({ length: 11 }, (_, i) => `<line x1="${X(i - 5)}" y1="${Y(-5.5)}" x2="${X(i - 5)}" y2="${Y(5.5)}"/><line x1="${X(-5.5)}" y1="${Y(i - 5)}" x2="${X(5.5)}" y2="${Y(i - 5)}"/>`).join('')}</g>`;
  b += `<line x1="${X(-5.5)}" y1="${oy}" x2="${X(5.5)}" y2="${oy}" stroke="${INK}" stroke-width="2"/><line x1="${ox}" y1="${Y(-5.5)}" x2="${ox}" y2="${Y(5.5)}" stroke="${INK}" stroke-width="2"/>`;
  b += `<text x="${X(5.5) + 6}" y="${oy + 5}" font-size="13" font-weight="700" fill="${INK}" font-family="Inter,sans-serif">x</text><text x="${ox + 6}" y="${Y(5.5) - 4}" font-size="13" font-weight="700" fill="${INK}" font-family="Inter,sans-serif">y</text>`;
  b += Array.from({ length: 11 }, (_, i) => i - 5).filter(i => i).map(i => `<text x="${X(i)}" y="${oy + 15}" font-size="9" text-anchor="middle" fill="${MUTE}" font-family="Inter,sans-serif">${i}</text><text x="${ox - 7}" y="${Y(i) + 3}" font-size="9" text-anchor="end" fill="${MUTE}" font-family="Inter,sans-serif">${i}</text>`).join('');
  b += `<line x1="${X(xs[0])}" y1="${Y(m * xs[0] + c)}" x2="${X(xs[1])}" y2="${Y(m * xs[1] + c)}" stroke="${RED}" stroke-width="3.5"/><circle cx="${ox}" cy="${Y(c)}" r="5" fill="${RED}"/>`;
  b += `<text x="${ox + 10}" y="${Y(c) - 8}" font-size="11" font-weight="600" fill="${RED}" font-family="Inter,sans-serif">(0, ${c})</text>`;
  b += `<text x="20" y="28" font-size="15" font-weight="700" fill="${INK}" font-family="Inter,sans-serif">y = ${m}x ${c < 0 ? '−' : '+'} ${Math.abs(c)}</text>`;
  b += txt(20, 330, { en: 'Slope m shows steepness; c is where the line crosses the y-axis.', ta: 'சாய்வு m கோட்டின் செங்குத்துத்தன்மையைக் காட்டும்; c என்பது y-அச்சை வெட்டும் புள்ளி.' }, g, { size: 11, anchor: 'start', fill: MUTE, weight: 500 });
  return wrapSvg('0 0 520 350', b, `Graph of y = ${m}x + ${c}`);
}

/* ---------------- registry ---------------- */
const ids: VId[] = ['heart', 'reflection', 'pythagoras', 'balance', 'graph'];
const LABELS: Record<VId, VLabel[]> = { heart: HEART, reflection: REFL, pythagoras: PYTH, balance: [], graph: [] };
export const VISUAL_IDS = ids;
export function normalizeKey(k: any): VKey | null {
  if (!k || !ids.includes(k.id)) return null; const out: VKey = { id: k.id };
  if (k.hl !== undefined) { if (!LABELS[k.id as VId].some(l => l.id === k.hl)) return null; out.hl = k.hl; }
  if (k.lvl !== undefined) { if (k.lvl !== 'full' && k.lvl !== 'simple') return null; out.lvl = k.lvl; }
  if (k.p !== undefined) { if (typeof k.p !== 'string' || k.p.length > 40 || !/^[0-9a-zA-Z+\-−×÷*/^().\s|=,]*$/.test(k.p)) return null; out.p = k.p; }
  return out;
}
export function renderSvg(key: VKey, lng: Lng = 'both'): string | null {
  const k = normalizeKey(key); if (!k) return null; const g: Lng = lng === 'en' || lng === 'ta' ? lng : 'both';
  return { heart, reflection, pythagoras, balance, graph }[k.id](k, g);
}
export const svgDataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
export const keyQuery = (k: VKey, lng: Lng) => { const q = new URLSearchParams({ lang: lng }); if (k.hl) q.set('hl', k.hl); if (k.lvl) q.set('lvl', k.lvl); if (k.p) q.set('p', k.p); return q.toString(); };
export const keyString = (k: VKey) => `${k.id}|${k.hl ?? ''}|${k.lvl ?? ''}|${k.p ?? ''}`;

const META: Record<VId, { topic: Bi; title: Bi; caption: Bi; alt: Bi; how: Bi; simple: boolean }> = {
  heart: { topic: { en: 'The human heart', ta: 'மனித இதயம்' }, title: { en: 'Heart: chambers and blood flow', ta: 'இதயம்: அறைகளும் இரத்த ஓட்டமும்' }, caption: { en: 'A simplified schematic (not an anatomical drawing). Blue = oxygen-poor blood, red = oxygen-rich blood.', ta: 'எளிமைப்படுத்தப்பட்ட வரைபடம் (உடற்கூறு வரைபடம் அல்ல). நீலம் = ஆக்சிஜன் குறைந்த இரத்தம், சிவப்பு = ஆக்சிஜன் நிறைந்த இரத்தம்.' }, alt: { en: 'Diagram of the four heart chambers: right atrium and right ventricle on the left, left atrium and left ventricle on the right, with arrows for blood flowing through the vena cava, lungs and aorta.', ta: 'இதயத்தின் நான்கு அறைகள்: இடப்புறம் வலது ஆரிக்கிள், வலது வென்ட்ரிக்கிள்; வலப்புறம் இடது ஆரிக்கிள், இடது வென்ட்ரிக்கிள்; பெருஞ்சிரை, நுரையீரல், பெருந்தமனி வழி இரத்த ஓட்ட அம்புகள்.' }, how: { en: 'Blood returns from the body to the right atrium, goes to the right ventricle, then to the lungs. It comes back to the left atrium, moves to the left ventricle and is pumped out through the aorta.', ta: 'உடலிலிருந்து இரத்தம் வலது ஆரிக்கிளுக்கு வந்து, வலது வென்ட்ரிக்கிள் வழியாக நுரையீரலுக்குச் செல்லும். பின் இடது ஆரிக்கிள், இடது வென்ட்ரிக்கிள் வழியாக பெருந்தமனியில் உடலுக்குச் செல்லும்.' }, simple: true },
  reflection: { topic: { en: 'Reflection of light', ta: 'ஒளியின் எதிரொளிப்பு' }, title: { en: 'Reflection from a plane mirror', ta: 'சமதள ஆடியில் எதிரொளிப்பு' }, caption: { en: 'The angle of incidence i equals the angle of reflection r (shown here at 40° as an example).', ta: 'படுகோணம் i, எதிரொளிப்புக் கோணம் r க்குச் சமம் (இங்கு எடுத்துக்காட்டாக 40°).' }, alt: { en: 'A ray hits a flat mirror at a point, a dashed normal stands at 90° to the mirror, and the reflected ray leaves at the same angle on the other side of the normal.', ta: 'ஒரு கதிர் சமதள ஆடியில் விழுகிறது; செங்குத்துக்கோடு 90° இல் உள்ளது; எதிரொளிப்புக் கதிர் அதே கோணத்தில் மறுபக்கம் செல்கிறது.' }, how: { en: 'A ray hits the mirror at O. Draw the normal at O. The reflected ray leaves so that angle i = angle r, and all three lines lie in one plane.', ta: 'கதிர் ஆடியில் O இல் விழுகிறது. O இல் செங்குத்துக்கோடு வரையுங்கள். எதிரொளிப்புக் கதிர் i = r ஆக வெளியேறும்; மூன்று கோடுகளும் ஒரே தளத்தில் இருக்கும்.' }, simple: true },
  pythagoras: { topic: { en: 'Right-angled triangle', ta: 'செங்கோண முக்கோணம்' }, title: { en: 'Right triangle: a² + b² = c²', ta: 'செங்கோண முக்கோணம்: a² + b² = c²' }, caption: { en: 'Example with sides 3, 4 and 5. The hypotenuse is opposite the right angle.', ta: 'பக்கங்கள் 3, 4, 5 உடன் எடுத்துக்காட்டு. கர்ணம் செங்கோணத்திற்கு எதிரில் உள்ளது.' }, alt: { en: 'A right-angled triangle with legs 3 and 4 and hypotenuse 5, with the right angle marked.', ta: 'செங்கோண முக்கோணம்: பக்கங்கள் 3, 4, கர்ணம் 5; செங்கோணம் குறிக்கப்பட்டுள்ளது.' }, how: { en: 'In a right triangle the square of the hypotenuse equals the sum of the squares of the other two sides: 9 + 16 = 25.', ta: 'செங்கோண முக்கோணத்தில் கர்ணத்தின் வர்க்கம் மற்ற இரு பக்கங்களின் வர்க்கங்களின் கூட்டலுக்குச் சமம்: 9 + 16 = 25.' }, simple: false },
  balance: { topic: { en: 'Balancing an equation', ta: 'சமன்பாட்டைச் சமநிலைப்படுத்துதல்' }, title: { en: 'Both sides of the equation', ta: 'சமன்பாட்டின் இரு பக்கங்கள்' }, caption: { en: 'What you do to one side you do to the other, so the equation stays true.', ta: 'ஒரு பக்கம் செய்வதை மறுபக்கமும் செய்தால் சமன்பாடு சரியாக இருக்கும்.' }, alt: { en: 'A balance scale with the left side of the equation on one pan and the right side on the other, level.', ta: 'சமன்பாட்டின் இடப்பக்கமும் வலப்பக்கமும் இரு தட்டுகளில் சமமாக உள்ள தராசு.' }, how: { en: 'The scale is level because both sides are equal. Each step changes both pans in the same way.', ta: 'இரு பக்கங்களும் சமம் என்பதால் தராசு சமமாக உள்ளது. ஒவ்வொரு படியும் இரு தட்டுகளையும் ஒரே மாதிரி மாற்றும்.' }, simple: false },
  graph: { topic: { en: 'Graph of a straight line', ta: 'நேர்கோட்டு வரைபடம்' }, title: { en: 'Graph of y = mx + c', ta: 'y = mx + c வரைபடம்' }, caption: { en: 'The red dot is where the line crosses the y-axis (the value of c).', ta: 'சிவப்புப் புள்ளி கோடு y-அச்சை வெட்டும் இடம் (c இன் மதிப்பு).' }, alt: { en: 'A coordinate plane with a straight red line and its y-intercept marked.', ta: 'நேர்கோடு மற்றும் அதன் y-வெட்டுப்புள்ளி குறிக்கப்பட்ட ஆயத்தளம்.' }, how: { en: 'Every point on the line satisfies the equation. m is the slope and c is the y-intercept.', ta: 'கோட்டின் ஒவ்வொரு புள்ளியும் சமன்பாட்டை நிறைவு செய்யும். m சாய்வு, c y-வெட்டுத்துண்டு.' }, simple: false },
};
export const canSimplify = (id: VId) => META[id].simple;
export const describeVisual = (k: VKey): Bi => META[k.id].how;
/** Meaning of the label the student mentioned, if any. */
export function labelMeaning(k: VKey, text: string): { label: VLabel } | null {
  const t = text.toLowerCase(); const hit = LABELS[k.id].find(l => t.includes(l.name.en.toLowerCase().replace(/\s*\(.*\)/, '')) || text.includes(l.name.ta.replace(/\s*\(.*\)/, '')));
  return hit ? { label: hit } : null;
}
export function makeVisual(key: VKey, step?: number): Visual {
  const m = META[key.id]; return { key, topic: m.topic, step, title: m.title, caption: m.caption, alt: m.alt, labels: LABELS[key.id],
    source: 'Original diagram drawn by Karkai AI in code', attribution: 'Karkai AI (original SVG)', license: 'Own work: no third-party image is used', kind: 'original-svg', score: 0.9, reviewed: false };
}

/* ---------------- detection ---------------- */
const RE: [VId, RegExp][] = [
  ['heart', /\bheart\b|இதய/i], ['reflection', /\breflect|\bmirror\b|ray diagram|எதிரொளி|ஒளி\s*பிரதிபலி/i],
  ['pythagoras', /pythagor|right[- ]?angled?\s*triangle|hypotenuse|பிதாகரஸ்|செங்கோண\s*முக்கோண|கர்ணம்/i],
];
const LINE = /\by\s*=\s*(-?\d*\.?\d*)\s*x\s*(?:([+\-−])\s*(\d+(?:\.\d+)?))?/i;
/** Which diagram (if any) a student's question asks about. Conversational text returns null. */
export function detectKey(text: string): VKey | null {
  if (!text.trim()) return null;
  for (const [id, re] of RE) if (re.test(text)) { const k: VKey = { id }; const hit = LABELS[id].find(l => text.toLowerCase().includes(l.name.en.toLowerCase().replace(/\s*\(.*\)/, '')) || text.includes(l.name.ta.replace(/\s*\(.*\)/, ''))); if (hit) k.hl = hit.id; return k; }
  const m = text.match(LINE); if (m && /graph|plot|வரைபட|line|கோடு/i.test(text)) { const mm = m[1] === '' || m[1] === undefined ? 1 : m[1] === '-' ? -1 : Number(m[1]); const cc = m[3] ? Number(m[3]) * (m[2] === '+' ? 1 : -1) : 0; if (Number.isFinite(mm)) return { id: 'graph', p: `${mm}|${cc}` }; }
  return null;
}
export type VisualInput = { student: string; chunkText: string; kind: string; first: boolean; math?: string[]; solver: boolean; mode: string; step?: number; total?: number; want?: VKey | null };
/** Decides which visuals go with one tutor chunk. Pure and cheap; the caller wraps it in try/catch so a failure never stops the lesson. */
export function visualsFor(i: VisualInput): Visual[] {
  if (i.want) { const k = normalizeKey(i.want); return k ? [makeVisual(k, i.step)] : []; }
  if (i.first && i.student) { const k = detectKey(i.student); if (k) return [makeVisual(k, i.step)]; }
  if (i.solver && i.kind === 'step' && i.math?.[0]?.includes('=')) {
    if (i.mode === 'explain' && i.total && i.total > 2 && i.step !== 1 && i.step !== i.total) return [];
    const [l, r] = i.math[0].split('='); if (l.trim() && r.trim()) return [makeVisual({ id: 'balance', p: `${l.trim()}|${r.trim()}` }, i.step)];
  }
  return [];
}
