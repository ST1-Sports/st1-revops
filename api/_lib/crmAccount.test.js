import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { websiteToDomain, mapAccountRow } from './crmAccount.js';

describe('websiteToDomain', () => {
  it('strips protocol and www', () => {
    assert.equal(websiteToDomain('https://www.hudson.k12.ia.us/athletics'), 'hudson.k12.ia.us');
    assert.equal(websiteToDomain('hudson.k12.ia.us'), 'hudson.k12.ia.us');
  });

  it('returns null for a blank website', () => {
    assert.equal(websiteToDomain(''), null);
    assert.equal(websiteToDomain(null), null);
  });
});

describe('mapAccountRow', () => {
  it('exposes website from domain or metadata for the CRM form', () => {
    assert.equal(mapAccountRow({
      id: '1',
      name: 'Hudson High School',
      normalizedName: 'hudson high school|ia',
      city: 'Hudson',
      state: 'IA',
      domain: 'hudson.k12.ia.us',
      zohoAccountId: 'z1',
      metadata: {},
    }).website, 'hudson.k12.ia.us');
    assert.equal(mapAccountRow({
      id: '2',
      name: 'Lincoln',
      normalizedName: 'lincoln',
      metadata: { website: 'https://lincoln.example' },
    }).website, 'https://lincoln.example');
  });
});
