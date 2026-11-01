import { describe, it, expect } from 'vitest';
import { AudioCache, splitSpoken } from '../shared/audioCache';
const blob = (n: number) => new Blob([new Uint8Array(n)]);
describe('AudioCache', () => {
  it('keys by conversation, message and segment', () => { expect(AudioCache.key('s1', 'm2', 3, 'ta')).toBe('s1:m2:3:ta'); });
  it('returns the same stored URL on every get (replay reuses the audio)', () => { const c = new AudioCache(1000); const u = c.set('a', blob(10)); expect(c.get('a')).toBe(u); expect(c.get('a')).toBe(u); expect(c.stats.items).toBe(1); });
  it('evicts least-recently-used clips and revokes their URLs when over the limit', () => {
    const c = new AudioCache(25); c.set('a', blob(10)); c.set('b', blob(10)); c.get('a'); c.set('c', blob(10));
    expect(c.has('b')).toBe(false); expect(c.has('a')).toBe(true); expect(c.has('c')).toBe(true); expect(c.stats.bytes).toBeLessThanOrEqual(25);
  });
  it('does not retain a clip larger than the whole limit', () => { const c = new AudioCache(5); c.set('big', blob(10)); expect(c.has('big')).toBe(false); });
  it('release frees everything', () => { const c = new AudioCache(100); c.set('a', blob(10)); c.set('b', blob(10)); c.clear(); expect(c.stats).toEqual({ items: 0, bytes: 0, maxBytes: 100 }); expect(c.get('a')).toBeNull(); });
});
describe('splitSpoken', () => {
  it('cuts long answers into short sentences so audio can start early', () => {
    const t = 'Step one is to move five. Then divide by three. ' + 'Finally check the answer by putting it back in. '.repeat(8);
    const parts = splitSpoken(t, 80); expect(parts.length).toBeGreaterThan(3); for (const p of parts) expect(p.length).toBeLessThanOrEqual(80 + 50); expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(t.trim().replace(/\s+/g, ' '));
  });
  it('splits Tamil on the danda and keeps short text whole', () => { expect(splitSpoken('இது ஒன்று। இது இரண்டு।', 10)).toHaveLength(2); expect(splitSpoken('Hello there.')).toEqual(['Hello there.']); expect(splitSpoken('no punctuation')).toEqual(['no punctuation']); });
});
