/**
 * Outgoing email: password-reset links, email verification and guardian approval.
 *
 *   MAIL_FROM=Karkai AI <no-reply@your-domain.in>      (required for any driver)
 *   RESEND_API_KEY=...                                    → Resend (HTTP API)
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE=1   → any SMTP service (SES, Zoho, Gmail Workspace, Brevo, ...)
 *   MAIL_DRIVER=log                                       → development only: prints the mail (and its links) to the server log
 *
 * With no driver configured `mailer()` is null: the app says plainly that email is not set up instead of pretending to send.
 */
export type Mail = { to: string; subject: string; text: string; html?: string };
export interface Mailer { readonly name: string; send(m: Mail): Promise<void> }

export function resendMailer(o: { apiKey: string; from: string; baseUrl?: string; timeoutMs?: number }): Mailer {
  const base = (o.baseUrl ?? 'https://api.resend.com').replace(/\/+$/, '');
  return {
    name: 'resend',
    async send(m) {
      const r = await fetch(`${base}/emails`, { method: 'POST', headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: o.from, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) }), signal: AbortSignal.timeout(o.timeoutMs ?? 15000) });
      if (!r.ok) throw new Error(`Resend returned ${r.status}`);
    },
  };
}

export function smtpMailer(o: { host: string; port?: number; user?: string; pass?: string; secure?: boolean; from: string; ignoreTls?: boolean }): Mailer {
  let transport: any;
  return {
    name: `smtp:${o.host}`,
    async send(m) {
      transport ??= (await import('nodemailer')).createTransport({ host: o.host, port: o.port ?? (o.secure ? 465 : 587), secure: !!o.secure, ignoreTLS: o.ignoreTls, auth: o.user ? { user: o.user, pass: o.pass ?? '' } : undefined, connectionTimeout: 10000, socketTimeout: 20000 });
      await transport.sendMail({ from: o.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    },
  };
}

/** Development only: nothing is sent; the mail is printed so a developer can follow the link. */
export const logMailer = (): Mailer => ({ name: 'log (development only)', async send(m) { console.log(`[mail:dev] to=${m.to} subject=${m.subject}\n${m.text}\n`); } });

export function mailerFromEnv(env = process.env): Mailer | null {
  const from = env.MAIL_FROM; const driver = (env.MAIL_DRIVER ?? (env.RESEND_API_KEY ? 'resend' : env.SMTP_HOST ? 'smtp' : '')).toLowerCase();
  if (driver === 'log') return env.NODE_ENV === 'production' ? null : logMailer(); // never "sends" nothing in production
  if (!from) return null;
  if (driver === 'resend' && env.RESEND_API_KEY) return resendMailer({ apiKey: env.RESEND_API_KEY, from, baseUrl: env.RESEND_BASE_URL });
  if (driver === 'smtp' && env.SMTP_HOST) return smtpMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT ? Number(env.SMTP_PORT) : undefined, user: env.SMTP_USER, pass: env.SMTP_PASS, secure: env.SMTP_SECURE === '1', from, ignoreTls: env.SMTP_IGNORE_TLS === '1' });
  return null;
}

let shared: Mailer | null | undefined;
/** Process-wide mailer (tests can replace it). */
export const mailer = (): Mailer | null => (shared === undefined ? (shared = mailerFromEnv()) : shared);
export const setMailer = (m: Mailer | null | undefined) => { shared = m; };
/** The public https address links in emails point to. Never taken from the request (a forged Host header must not choose where a reset link goes). */
export const publicUrl = () => (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
