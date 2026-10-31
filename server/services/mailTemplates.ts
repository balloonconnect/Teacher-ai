import type { Mail } from './mailer';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const first = (name: string) => name.trim().split(/\s+/)[0] || name;
function wrap(subject: string, paras: string[], link: { url: string; label: string }, foot: string[]): Pick<Mail, 'subject' | 'text' | 'html'> {
  const text = [...paras, '', `${link.label}: ${link.url}`, '', ...foot].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;line-height:1.5;color:#1f2937">${paras.map(p => `<p>${esc(p)}</p>`).join('')}<p><a href="${esc(link.url)}" style="display:inline-block;background:#0a3d91;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${esc(link.label)}</a></p><p style="font-size:13px;color:#6b7280">If the button does not work, copy this address into your browser:<br>${esc(link.url)}</p>${foot.map(p => `<p style="font-size:13px;color:#6b7280">${esc(p)}</p>`).join('')}</div>`;
  return { subject, text, html };
}

export const resetMail = (to: string, name: string, url: string): Mail => ({ to, ...wrap('Reset your Karkai AI password · கடவுச்சொல்லை மாற்றுங்கள்', [
  `Hello ${first(name)}, we received a request to reset your Karkai AI password. This link works once and expires in 1 hour.`,
  `வணக்கம் ${first(name)}, உங்கள் கற்கை AI கடவுச்சொல்லை மாற்றக் கோரிக்கை வந்தது. இந்த இணைப்பு ஒருமுறை மட்டுமே செயல்படும்; 1 மணி நேரத்தில் காலாவதியாகும்.`,
], { url, label: 'Choose a new password / புதிய கடவுச்சொல்' }, ['If you did not ask for this, ignore this email; your password stays the same. / நீங்கள் கோரவில்லை என்றால் இந்த மின்னஞ்சலைப் புறக்கணிக்கவும்.']) });

export const verifyMail = (to: string, name: string, url: string): Mail => ({ to, ...wrap('Confirm your email · மின்னஞ்சலை உறுதிசெய்யுங்கள்', [
  `Hello ${first(name)}, please confirm that this email address is yours. The link is valid for 3 days.`,
  `வணக்கம் ${first(name)}, இந்த மின்னஞ்சல் முகவரி உங்களுடையது என்பதை உறுதிசெய்யுங்கள். இணைப்பு 3 நாட்களுக்குச் செல்லும்.`,
], { url, label: 'Confirm my email / உறுதிசெய்' }, ['If you did not create a Karkai AI account, ignore this email.']) });

export const guardianMail = (to: string, guardianName: string, studentName: string, url: string): Mail => ({ to, ...wrap(`Please approve ${first(studentName)}’s Karkai AI account · அனுமதி தேவை`, [
  `Hello ${guardianName}, ${studentName} has signed up for Karkai AI, a study platform for Tamil Nadu school students, and is under 13. We need a parent or guardian to approve the account before it can be used.`,
  `வணக்கம் ${guardianName}, ${studentName} கற்கை AI-இல் பதிவு செய்துள்ளார். 13 வயதுக்குட்பட்டவர் என்பதால், கணக்கைப் பயன்படுத்த பெற்றோர் / பாதுகாவலரின் அனுமதி தேவை.`,
  'On the page you will see what the account does and can approve or decline. The link is valid for 7 days.',
], { url, label: 'Review and decide / பார்த்து முடிவு செய்க' }, ['If you do not know this child, choose “Decline” or ignore this email; the account stays locked.']) });

export const changedMail = (to: string, name: string): Mail => ({ to, subject: 'Your Karkai AI password was changed · கடவுச்சொல் மாற்றப்பட்டது', text: [`Hello ${first(name)}, the password of your Karkai AI account was just changed, and you were signed out everywhere.`, `வணக்கம் ${first(name)}, உங்கள் கற்கை AI கடவுச்சொல் மாற்றப்பட்டது; எல்லா சாதனங்களிலிருந்தும் வெளியேற்றப்பட்டீர்கள்.`, '', 'If this was not you, ask your school administrator for help straight away.'].join('\n') });
