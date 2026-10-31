/** Only same-site paths inside the app are allowed as a post-login destination. */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) return null;
  return /^\/(app|profile|verify)(\/|\?|$)/.test(raw) ? raw : null;
}
