/** Session-level audio cache: key = conversation:message:segment:lang. Least-recently-used eviction by bytes; everything is revoked on release. */
export class AudioCache {
  private m = new Map<string, { url: string; bytes: number }>(); private total = 0;
  constructor(public maxBytes: number) {}
  static key(session: string, message: string, segment: number, lang: string) { return `${session}:${message}:${segment}:${lang}`; }
  has(k: string) { return this.m.has(k); }
  get(k: string) { const v = this.m.get(k); if (!v) return null; this.m.delete(k); this.m.set(k, v); return v.url; }
  set(k: string, blob: Blob) {
    if (blob.size > this.maxBytes) return URL.createObjectURL(blob); // too big to keep: usable once, not retained (caller must not rely on it later)
    this.delete(k); const url = URL.createObjectURL(blob); this.m.set(k, { url, bytes: blob.size }); this.total += blob.size;
    while (this.total > this.maxBytes && this.m.size > 1) { const [ok] = this.m.entries().next().value!; this.delete(ok); }
    return url;
  }
  delete(k: string) { const v = this.m.get(k); if (v) { URL.revokeObjectURL(v.url); this.total -= v.bytes; this.m.delete(k); } }
  clear() { for (const k of [...this.m.keys()]) this.delete(k); }
  get stats() { return { items: this.m.size, bytes: this.total, maxBytes: this.maxBytes }; }
}

/** Cuts a spoken segment into short sentences (≤ ~220 chars) so audio starts after the first sentence, not the whole answer. */
export function splitSpoken(text: string, max = 220): string[] {
  const sent = text.split(/(?<=[.!?।])\s+/).map(s => s.trim()).filter(Boolean); const out: string[] = [];
  for (const s of sent) { const last = out[out.length - 1]; if (last && (last + ' ' + s).length <= max) out[out.length - 1] = last + ' ' + s; else out.push(s); }
  return out.length ? out : [text];
}

