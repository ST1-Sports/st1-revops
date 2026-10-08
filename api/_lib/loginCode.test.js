import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateLoginCode,
  hashLoginCode,
  isAllowedLoginEmail,
  normalizeLoginEmail,
  repNameFromEmail,
  safeEqual,
} from './loginCode.js';

describe('normalizeLoginEmail', () => {
  it('trims and lowercases', () => {
    assert.equal(normalizeLoginEmail('  Keith@ST1Sports.com  '), 'keith@st1sports.com');
  });

  it('handles null/undefined without throwing', () => {
    assert.equal(normalizeLoginEmail(undefined), '');
    assert.equal(normalizeLoginEmail(null), '');
  });
});

describe('isAllowedLoginEmail', () => {
  it('accepts any @st1sports.com address, case-insensitive', () => {
    assert.equal(isAllowedLoginEmail('keith@st1sports.com'), true);
    assert.equal(isAllowedLoginEmail('Keith.Jones@ST1SPORTS.COM'), true);
    assert.equal(isAllowedLoginEmail('matt+test@st1sports.com'), true);
  });

  it('rejects everything else', () => {
    assert.equal(isAllowedLoginEmail('keith@gmail.com'), false);
    assert.equal(isAllowedLoginEmail('keith@st1sports.com.evil.com'), false);
    assert.equal(isAllowedLoginEmail(''), false);
    assert.equal(isAllowedLoginEmail(undefined), false);
  });
});

describe('repNameFromEmail', () => {
  it('title-cases a dotted local part', () => {
    assert.equal(repNameFromEmail('keith.jones@st1sports.com'), 'Keith Jones');
  });

  it('handles underscores and hyphens too', () => {
    assert.equal(repNameFromEmail('mary_ann-smith@st1sports.com'), 'Mary Ann Smith');
  });

  it('falls back to a non-empty name for an odd local part', () => {
    assert.equal(repNameFromEmail('@st1sports.com'), 'New User');
  });
});

describe('generateLoginCode', () => {
  it('always returns a zero-padded 6-digit string', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateLoginCode();
      assert.equal(code.length, 6);
      assert.ok(/^\d{6}$/.test(code), `expected 6 digits, got ${code}`);
    }
  });
});

describe('hashLoginCode / safeEqual', () => {
  it('hashes deterministically and verifies via safeEqual', () => {
    const h1 = hashLoginCode('123456');
    const h2 = hashLoginCode('123456');
    assert.equal(h1, h2);
    assert.equal(safeEqual(h1, h2), true);
  });

  it('does not match a different code\'s hash', () => {
    assert.equal(safeEqual(hashLoginCode('123456'), hashLoginCode('654321')), false);
  });
});
