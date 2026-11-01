/** Public page for checking Tamil rendering in a real browser (see scripts/tamil-browser-check.mjs). Shows known-correct text; nothing here is user data. */
export const TAMIL_SAMPLES: [string, string][] = [
  ['A', 'தமிழ் மொழி இனிமையானது. கல்வி மனித வாழ்க்கைக்கு மிகவும் முக்கியமானது.'],
  ['B', 'கல்வி, அறிவு, ஒழுக்கம், வாழ்க்கை, மகிழ்ச்சி, குழந்தைகள், திருக்குறள், கவிதை.'],
  ['C', 'அகர முதல எழுத்தெல்லாம் ஆதி\nபகவன் முதற்றே உலகு.'],
];
export default function TamilTest() {
  return <main className="col" style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}><h1>Tamil rendering check</h1>
    {TAMIL_SAMPLES.map(([k, t]) => <section key={k}><h2>Test {k}</h2><p id={`t-${k}`} lang="ta" className="ta" style={{ fontSize: 24, whiteSpace: 'pre-line' }}>{t}</p><p id={`t-${k}-bold`} lang="ta" className="ta" style={{ fontSize: 24, fontWeight: 700, whiteSpace: 'pre-line' }}>{t}</p></section>)}
    <textarea id="t-edit" lang="ta" className="ta" defaultValue={TAMIL_SAMPLES[0][1]} rows={3} style={{ fontSize: 20 }} aria-label="Editable Tamil sample" /></main>;
}
