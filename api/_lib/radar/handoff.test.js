import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handOffBradReply } from './brad.js';
import { isSeedableVendorDomain } from './seed.js';

const args = {
  assigned: { name: 'Rep', email: 'rep@st1sports.com' },
  fromEmail: 'coach@school.org',
  contactName: 'Coach',
  subject: 'Re: uniforms',
  bodyText: 'Yes, send pricing',
};

describe('Brad positive replies are never lost', () => {
  it('files to Radar and skips the email when the rep has a live Radar connection', async () => {
    let emailed = 0;
    const r = await handOffBradReply('host', args, {
      upsert: async () => ({ ok: true, connected: true, followUpItemId: 'f1' }),
      email: async () => { emailed++; return { ok: true }; },
    });
    assert.equal(emailed, 0);
    assert.equal(r.email, 'skipped');
    assert.equal(r.followUpItemId, 'f1');
  });

  it('still emails the rep when they have not connected Radar', async () => {
    let emailed = 0;
    const r = await handOffBradReply('host', args, {
      upsert: async () => ({ ok: true, connected: false, followUpItemId: 'f2' }),
      email: async () => { emailed++; return { ok: true }; },
    });
    assert.equal(emailed, 1);
    assert.equal(r.email, 'sent');
  });

  it('falls back to email and never throws when Radar fails', async () => {
    const r = await handOffBradReply('host', args, {
      upsert: async () => { throw new Error('unique constraint'); },
      email: async () => ({ ok: true }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.email, 'sent');
    const both = await handOffBradReply('host', args, {
      upsert: async () => { throw new Error('db down'); },
      email: async () => { throw new Error('smtp down'); },
    });
    assert.equal(both.email, 'smtp down');
  });
});

describe('vendor domain seeding', () => {
  it('never treats public mailboxes or schools as vendors', () => {
    for (const d of ['gmail.com', 'yahoo.com', 'outlook.com', 'school.k12.ia.us', 'state.edu', 'st1sports.com', ''])
      assert.equal(isSeedableVendorDomain(d), false, d);
    assert.equal(isSeedableVendorDomain('gillathletics.com'), true);
  });
});
