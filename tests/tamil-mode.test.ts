import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { translate } from '../src/i18n/translate';
import { TA } from '../src/i18n/ta';

const TAMIL = /[஀-௿]/;

describe('pure Tamil mode', () => {
  it('translates labels, sentences and server messages into Tamil', () => {
    expect(translate('Sign in')).toBe('உள்நுழை');
    expect(translate('  Practice   centre ')).toBe('பயிற்சி மையம்');
    expect(translate('Email or password is incorrect.')).toMatch(TAMIL);
    expect(translate('Passwords do not match')).toMatch(TAMIL);
  });
  it('handles numbers, dates, times and names with patterns', () => {
    expect(translate('Fri 23')).toBe('வெள் 23');
    expect(translate('20 min')).toBe('20 நிமிடம்');
    expect(translate('5 questions')).toBe('5 கேள்விகள்');
    expect(translate('· Class 8')).toBe('· 8-ஆம் வகுப்பு');
    expect(translate('Mathematics — Weekly Test 7 (written answer)')).toBe('கணிதம் — வாராந்திரத் தேர்வு 7 (எழுத்து விடை)');
    expect(translate('Closes நவ. 1, 6:25 AM')).toBe('முடிவு: நவ. 1, 6:25 முற்பகல்');
    expect(translate('Opens அக். 31, 6:25 PM')).toBe('தொடக்கம்: அக். 31, 6:25 பிற்பகல்');
    expect(translate('Notifications, 3 unread')).toBe('அறிவிப்புகள், 3 படிக்கப்படாதவை');
  });
  it('translates the parts of "a · b · c" strings and leaves numbers and names alone', () => {
    expect(translate('Class 8 · English medium · 2026–2027 · Ref KM-AB12CD34')).toBe('8-ஆம் வகுப்பு · ஆங்கில வழி · 2026–2027 · குறிப்பு எண் KM-AB12CD34');
    expect(translate('Sign in · Karkai AI')).toBe('உள்நுழை · கற்கை AI');
    expect(translate('கற்கை AI')).toBeNull(); // already Tamil
    expect(translate('42')).toBeNull();
  });
  it('every dictionary entry is real Tamil (no copy-paste of the English, no empty text)', () => {
    const bad = Object.entries(TA).filter(([k, v]) => v !== '' && !TAMIL.test(v) && !/^(PDF|https:\/\/…|DELETE)$/.test(v) && v !== k).map(([k]) => k);
    expect(bad).toEqual([]);
    const same = Object.entries(TA).filter(([k, v]) => k === v && /[A-Za-z]{3,}/.test(k) && !['PDF', 'https://…'].includes(k)).map(([k]) => k);
    expect(same).toEqual([]);
  });
  it('no student-facing English string in the source is missing from the dictionary', () => {
    // scripts/ta-strings.ts walks every student, account and public screen's JSX text, attributes and toasts; --check fails when any has no translation.
    expect(() => execFileSync('npx', ['tsx', 'scripts/ta-strings.ts', '--check'], { cwd: process.cwd(), stdio: 'pipe', timeout: 120_000 })).not.toThrow();
  }, 130_000);
});
