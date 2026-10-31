/**
 * UI-preview mode (VITE_UI_PREVIEW=1): a browser-only stand-in for the API so the UI flow can be reviewed
 * without a backend. Nothing here is real: one fixed demo login, canned tutor replies, data kept in this
 * browser tab only. It is switched off by default and must not be used in production.
 */
export const PREVIEW = import.meta.env.VITE_UI_PREVIEW === '1';
export const PREVIEW_LOGIN = { username: 'vikikalvi', password: 'demo@12345' };

class PErr extends Error { constructor(public status: number, m: string) { super(m); } }
const USER = { id: 'u-preview', email: 'vikikalvi@preview.local', display_name: 'Viki', role: 'student', school_id: null };
const ACTIONS: Record<string, { en: string; ta: string }> = {
  simpler: { en: 'Explain simply', ta: 'எளிமையாக விளக்கு' }, steps: { en: 'Solve step by step', ta: 'படிப்படியாகத் தீர்' },
  hint: { en: 'Give a hint', ta: 'குறிப்பு கொடு' }, another: { en: 'Show another example', ta: 'இன்னொரு எடுத்துக்காட்டு' },
};
type St = { signedIn: boolean; user?: any; profile?: any; emails?: string[]; convs: any[]; msgs: Record<string, any[]>; done?: boolean; mat?: boolean; marks?: any[]; completed?: string[]; mm?: Record<string, { understood: string[]; revision: string[] }> };
const mem: St = { signedIn: false, convs: [], msgs: {} };
const load = (): St => { try { const s = sessionStorage.getItem('kavli_preview'); return s ? JSON.parse(s) : mem; } catch { return mem; } };
const save = (s: St) => { try { sessionStorage.setItem('kavli_preview', JSON.stringify(s)); } catch { Object.assign(mem, s); } };
const id = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

function reply(text: string, action?: string) {
  const t = text.toLowerCase().replace(/\s+/g, '');
  const m = t.match(/^(?:solve)?(-?\d*\.?\d*)x([+-]\d+\.?\d*)?=(-?\d+\.?\d*)$/);
  let en: string, ta: string;
  if (m) {
    const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1]); const b = Number(m[2] ?? 0); const c = Number(m[3]);
    if (a === 0) { en = 'The coefficient of x is 0, so this is not a linear equation in x.'; ta = 'x இன் கெழு 0 என்பதால் இது x இல் நேரியல் சமன்பாடு அல்ல.'; }
    else { const x = (c - b) / a; const x4 = Math.round(x * 1e4) / 1e4;
      en = `Let’s solve it step by step.\n1. Start with ${text.replace(/^solve\s*/i, '')}\n2. Move the constant: ${a}x = ${c - b}\n3. Divide both sides by ${a}: x = ${x4}\n4. Check by putting x = ${x4} back.`;
      ta = `படிப்படியாகத் தீர்ப்போம்.\n1. சமன்பாட்டை எழுதுங்கள்\n2. மாறிலியை நகர்த்துங்கள்: ${a}x = ${c - b}\n3. இரு பக்கமும் ${a} ஆல் வகுக்கவும்: x = ${x4}\n4. x = ${x4} ஐ மீண்டும் இட்டுச் சரிபார்க்கவும்.`; }
  } else if (/^(hi|hello|vanakkam|வணக்கம்)/i.test(text.trim())) { en = 'Hello! Ask me a question, or type an equation like 2x + 3 = 11.'; ta = 'வணக்கம்! ஒரு கேள்வி கேளுங்கள், அல்லது 2x + 3 = 11 போன்ற சமன்பாட்டை உள்ளிடுங்கள்.'; }
  else { en = `This is a UI preview, so I can only solve simple equations like 2x + 3 = 11. You asked${action ? ` (“${ACTIONS[action]?.en ?? action}”)` : ''}: “${text}”.`; ta = `இது UI முன்னோட்டம் மட்டுமே; 2x + 3 = 11 போன்ற எளிய சமன்பாடுகளை மட்டுமே தீர்க்க முடியும்.`; }
  return { en, ta };
}

export async function previewApi(method: string, url: string, body: any): Promise<any> {
  const s = load(); const path = url.split('?')[0];
  if (path === '/config') return { production: false, demoAccounts: true, aiProvider: 'ui-preview', aiIsMock: true, ocrAvailable: false, preview: true };
  if (path === '/auth/me') { if (!s.signedIn) return { user: null }; if (s.user) return { user: s.user, profile: s.profile ?? null, needsProfile: false, csrf: 'preview' }; if (!DATA) DATA = (await import('./preview-data.json')).default; return fresh({ ...DATA.base['/auth/me'], csrf: 'preview' }, s); }
  if (path === '/auth/register') {
    // Preview only: validates the same rules, keeps the account for this tab, stores no password.
    const email = String(body?.email ?? '').trim().toLowerCase();
    if (email === USER.email || s.emails?.includes(email)) throw new PErr(409, 'An account with this email already exists. Try signing in.');
    if (body?.role === 'admin' || !['student', 'parent', 'teacher', 'school_admin'].includes(body?.role)) throw new PErr(400, 'Choose a valid account type.');
    const staff = body.role === 'teacher' || body.role === 'school_admin';
    s.user = { id: id(), email, display_name: String(body.displayName), role: staff ? 'pending' : body.role, school_id: null };
    s.profile = body.role === 'student' ? { full_name: body.displayName, preferred_name: body.displayName, class_level: body.student?.classLevel, medium: body.student?.medium, voice_prefs: { rate: 1 } } : null;
    s.emails = [...(s.emails ?? []), email]; s.signedIn = true; save(s);
    return { user: s.user, csrf: 'preview', needsProfile: false, requestedRole: body.role, pendingApproval: staff };
  }
  if (path === '/auth/login') {
    const u = String(body?.email ?? '').trim().toLowerCase();
    if (u !== PREVIEW_LOGIN.username || body?.password !== PREVIEW_LOGIN.password) throw new PErr(401, 'Email or password is incorrect.');
    s.signedIn = true; s.user = undefined; save(s); if (!DATA) DATA = (await import('./preview-data.json')).default; return { user: DATA.login.user ?? DATA.base['/auth/me'].user, csrf: 'preview' };
  }
  if (path === '/auth/logout') { s.signedIn = false; s.user = undefined; save(s); return { ok: true }; }
  if (!s.signedIn) throw new PErr(401, 'Please sign in.');
  const rep = await replay(method, path, url, body, s); if (rep !== undefined) return rep;
  if (path === '/tutor/conversations') {
    if (method === 'GET') return { conversations: [...s.convs].reverse(), provider: { name: 'ui-preview', mock: true }, actions: ACTIONS };
    const c = { id: id(), title: body?.title ?? 'New conversation', created_at: now() }; s.convs.push(c); s.msgs[c.id] = []; save(s); return { conversation: c };
  }
  const mm = path.match(/^\/tutor\/conversations\/([^/]+)(\/messages)?$/);
  if (mm) {
    const c = s.convs.find(x => x.id === mm[1]); if (!c) throw new PErr(404, 'Conversation not found.');
    if (!mm[2]) { s.convs = s.convs.filter(x => x.id !== c.id); delete s.msgs[c.id]; save(s); return { ok: true }; }
    if (method === 'GET') return { conversation: c, messages: s.msgs[c.id] };
    const text = String(body?.text ?? ''); const u = { id: id(), role: 'user', content: { en: text, ta: text }, meta: {}, created_at: now() };
    const a = { id: id(), role: 'assistant', content: reply(text, body?.action), meta: { mock: true, provider: 'ui-preview', suggestions: ['steps', 'hint', 'another'] }, created_at: now() };
    s.msgs[c.id].push(u, a); if (c.title === 'New conversation' && text) c.title = text.slice(0, 60); save(s); return { messages: [u, a] };
  }
  if (path.startsWith('/tutor/messages/')) return { ok: true };
  if (path.startsWith('/voice/')) {
    if (path === '/voice/config') return { engine: { mock: true }, notes: '' };
    if (path === '/voice/sessions' && method === 'POST') return { session: { id: 'preview-voice', mode: body?.mode ?? 'teach', lang: body?.lang ?? 'both', showBoth: body?.showBoth ?? true, topic: null, state: {}, status: 'active', updatedAt: now() } };
    if (path === '/voice/sessions') return { sessions: [] };
    return { ok: true, session: { id: 'preview-voice', mode: body?.mode ?? 'teach', lang: body?.lang ?? 'both', showBoth: true, state: {}, status: 'active' }, turns: [] };
  }
  if (method === 'GET' && url === '/textbooks') return { textbooks: [] };
  if (method === 'GET' && url.startsWith('/textbooks/for-lesson/')) return { pages: [] };
  throw new PErr(404, 'Not available in UI preview.');
}
export { PErr };

// ---------- replay of recorded real responses (scripts/record-preview.ts) ----------
let DATA: any = null;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
function fresh(x: any, s: St): any {
  const delta = Date.now() - Date.parse(DATA.recordedAt); const name = s.user?.role === 'student' ? s.user.display_name : null;
  const walk = (v: any): any => typeof v === 'string' ? (ISO.test(v) ? new Date(Date.parse(v) + delta).toISOString() : name ? v.replace(/Meenakshi Kumar/g, name).replace(/\bMeena\b/g, name.split(' ')[0]) : v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, w]) => [k, walk(w)])) : v;
  return walk(x);
}
async function replay(method: string, path: string, url: string, body: any, s: St): Promise<any> {
  if (!DATA) DATA = (await import('./preview-data.json')).default;
  const D = DATA; const R = (x: any) => fresh(x, s); const m = (re: RegExp) => path.match(re);
  const done = !!s.done; const key = url;
  if (method === 'GET') {
    if (path === '/bookmarks') return { bookmarks: s.marks ?? D.base['/bookmarks'].bookmarks };
    if (path === '/materials') return R({ materials: s.mat ? D.material.list.materials : [], capabilities: D.base['/materials'].capabilities });
    if (path === '/notifications') return R(done ? D.after['/notifications'] : D.base['/notifications']);
    if (done && D.after[path]) return R(D.after[path]);
    if (D.base[key] !== undefined) return R(D.base[key]);
    let x: RegExpMatchArray | null;
    if ((x = m(/^\/lessons\/([^/]+)\/mindmap$/))) { const mp = D.mindmaps?.[x[1]]; if (!mp) throw new PErr(404, 'Lesson not found.'); return { ...mp, state: { ...(s.mm?.[x[1]] ?? { understood: [], revision: [] }), viewedAt: new Date().toISOString() } }; }
    if (path === '/mindmaps/recent') return { recent: Object.entries(s.mm ?? {}).map(([lid, v]) => ({ lessonId: lid, title_en: D.mindmaps?.[lid]?.map.title_en ?? lid, title_ta: D.mindmaps?.[lid]?.map.title_ta ?? lid, understood: v.understood.length, revision: v.revision.length, viewedAt: new Date().toISOString() })) };
    if ((x = m(/^\/lessons\/([^/]+)$/))) { if (D.lessons[x[1]]) return R(D.lessons[x[1]]); throw new PErr(404, 'Lesson not found.'); }
    if ((x = m(/^\/tests\/([^/]+)$/))) { if (done && x[1] === D.attempt.testId) return R(D.after.testDetail); if (D.tests[x[1]]) return R(D.tests[x[1]]); throw new PErr(404, 'Test not found.'); }
    if ((x = m(/^\/attempts\/([^/]+)$/))) return R(D.attempt.pre);
    if ((x = m(/^\/attempts\/([^/]+)\/result$/))) return R(D.attempt.result);
    if ((x = m(/^\/attempts\/([^/]+)\/review$/))) return R(D.attempt.review);
    if ((x = m(/^\/certificates\/([^/]+)\/history$/))) return R(D.attempt.certHistory);
    if ((x = m(/^\/verify\/([^/]+)$/))) { if (D.verify[x[1]]) return R(D.verify[x[1]]); throw new PErr(404, 'Certificate not found.'); }
    if ((x = m(/^\/materials\/([^/]+)$/)) && s.mat) return R(D.material.detail);
    return undefined;
  }
  if (method === 'POST') {
    let x: RegExpMatchArray | null;
    if ((x = m(/^\/tests\/([^/]+)\/attempts$/))) return R(D.attempt.start);
    if ((x = m(/^\/attempts\/([^/]+)\/submit$/))) { s.done = true; save(s); return R(D.attempt.submit); }
    if (path === '/practice/start') return R(D.practice.start);
    if ((x = m(/^\/practice\/([^/]+)\/submit$/))) return R(D.practice.submit);
    if (m(/^\/lessons\/[^/]+\/open$/)) return { ok: true };
    if ((x = m(/^\/lessons\/([^/]+)\/complete$/))) { s.completed = [...(s.completed ?? []), x[1]]; save(s); return { ok: true }; }
    if (path === '/bookmarks') { s.marks = [...(s.marks ?? D.base['/bookmarks'].bookmarks), { id: id(), student_id: 'preview', kind: body?.kind, ref: body?.ref, title: body?.title ?? '', created_at: now() }]; save(s); return { ok: true }; }
    if (path === '/notifications/read') return { ok: true };
    if (path === '/profile/guardian-code') return { code: 'K7M2QX' };
    if (path === '/materials/upload' || path === '/materials/link') { s.mat = true; save(s); return R(D.material.upload); }
    if ((x = m(/^\/materials\/[^/]+\/(ask|notes|quiz)$/))) return R(D.material[x[1]]);
    if (path === '/materials/' || /^\/materials\/[^/]+\/(ocr|text)$/.test(path)) throw new PErr(422, 'Not available in UI preview.');
    if (/^\/assignments\/[^/]+\/submit$/.test(path)) throw new PErr(422, 'Not available in UI preview.');
  }
  if (method === 'PUT') {
    { const x = path.match(/^\/lessons\/([^/]+)\/mindmap\/state$/); if (x) { const ids = new Set<string>((D.mindmaps?.[x[1]]?.map.nodes ?? []).map((n: any) => n.id)); const u = [...new Set<string>(body?.understood ?? [])].filter(i => ids.has(i)); const r = [...new Set<string>(body?.revision ?? [])].filter(i => ids.has(i) && !u.includes(i)); s.mm = { ...(s.mm ?? {}), [x[1]]: { understood: u, revision: r } }; save(s); return { understood: u, revision: r }; } }
    if (/^\/attempts\/[^/]+\/answers$/.test(path)) return { saved: true, serverTime: now() };
    if (path === '/profile') return { profile: { ...(D.base['/profile'].profile ?? {}), full_name: body?.fullName, class_level: body?.classLevel } };
    if (/^\/materials\/[^/]+\/text$/.test(path)) throw new PErr(422, 'Not available in UI preview.');
  }
  if (method === 'DELETE') {
    if (path === '/bookmarks') { s.marks = (s.marks ?? D.base['/bookmarks'].bookmarks).filter((b: any) => !(b.kind === new URLSearchParams(url.split('?')[1]).get('kind') && b.ref === new URLSearchParams(url.split('?')[1]).get('ref'))); save(s); return { ok: true }; }
    let x: RegExpMatchArray | null;
    if ((x = m(/^\/bookmarks\/([^/]+)$/))) { s.marks = (s.marks ?? D.base['/bookmarks'].bookmarks).filter((b: any) => b.id !== x![1]); save(s); return { ok: true }; }
    if (/^\/materials\/[^/]+$/.test(path)) { s.mat = false; save(s); return { ok: true }; }
  }
  return undefined;
}
