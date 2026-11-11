import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  campaignSubjectKeys,
  hardFilter,
  isNoreplyAddress,
  isWarmupThread,
  normalizeSubject,
} from './filters.js';

function msg({ from, to = [], cc = [], subject = 'Uniforms', body = 'hello', at = Date.now() }) {
  return { from, to, cc, subject, body, internalDate: at };
}

function thread(messages, extra = {}) {
  return {
    id: 't1',
    subject: messages[0]?.subject || 'Uniforms',
    messages,
    labelIds: extra.labelIds || [],
    labelNames: extra.labelNames || [],
  };
}

const owner = 'matt@st1sports.com';
const school = 'ad@westside.edu';
const vendors = new Set(['gillathletics.com', 'wilson.com', 'pmpprinting.com']);

describe('hardFilter — internal', () => {
  it('excludes threads where every other participant is @st1sports.com', () => {
    const t = thread([
      msg({ from: owner, to: ['keith@st1sports.com'] }),
      msg({ from: 'keith@st1sports.com', to: [owner], body: 'got it' }),
    ]);
    const r = hardFilter(t, { ownerEmail: owner, vendorDomains: vendors });
    assert.equal(r.exclude, true);
    assert.equal(r.reason, 'internal');
  });
});

describe('hardFilter — one-way / campaign', () => {
  it('excludes one-way blasts where the external party never wrote', () => {
    const t = thread([
      msg({ from: owner, to: [school], body: 'checking in on uniforms' }),
    ]);
    const r = hardFilter(t, { ownerEmail: owner, vendorDomains: vendors });
    assert.equal(r.exclude, true);
    assert.equal(r.reason, 'one_way');
  });

  it('excludes campaign subjects (10+ recipients / 48h) when the recipient never replied', () => {
    const recips = Array.from({ length: 12 }, (_, i) => `ad${i}@school${i}.edu`);
    const events = recips.map((email, i) => ({
      subject: 'Spring booking special',
      recipients: [email],
      at: Date.now() - i * 60 * 60 * 1000,
    }));
    const campaign = campaignSubjectKeys(events);
    assert.equal(campaign.has(normalizeSubject('Spring booking special')), true);

    const t = thread([
      msg({ from: owner, to: ['ad0@school0.edu'], subject: 'Re: Spring booking special' }),
    ]);
    const r = hardFilter(t, {
      ownerEmail: owner,
      vendorDomains: vendors,
      campaignSubjects: campaign,
    });
    assert.equal(r.exclude, true);
    assert.equal(r.reason, 'campaign');
  });

  it('keeps a campaign-subject thread when the external party replied', () => {
    const recips = Array.from({ length: 12 }, (_, i) => `ad${i}@school${i}.edu`);
    const campaign = campaignSubjectKeys(recips.map(email => ({
      subject: 'Spring booking special',
      recipients: [email],
      at: Date.now(),
    })));
    const t = thread([
      msg({ from: owner, to: ['ad0@school0.edu'], subject: 'Spring booking special', body: 'booking prices' }),
      msg({ from: 'ad0@school0.edu', to: [owner], subject: 'Re: Spring booking special', body: 'yes send pricing' }),
    ]);
    const r = hardFilter(t, {
      ownerEmail: owner,
      vendorDomains: vendors,
      campaignSubjects: campaign,
    });
    assert.equal(r.exclude, false);
  });
});

describe('hardFilter — vendor / noreply / warmup', () => {
  it('excludes vendor domains', () => {
    const t = thread([
      msg({ from: owner, to: ['orders@gillathletics.com'] }),
      msg({ from: 'orders@gillathletics.com', to: [owner], body: 'PO 123 confirmed' }),
    ]);
    const r = hardFilter(t, { ownerEmail: owner, vendorDomains: vendors });
    assert.equal(r.exclude, true);
    assert.equal(r.reason, 'vendor');
  });

  it('excludes noreply / support / receipt patterns', () => {
    assert.equal(isNoreplyAddress('noreply@school.edu'), true);
    assert.equal(isNoreplyAddress('do-not-reply@vendor.com'), true);
    assert.equal(isNoreplyAddress('orders@store.com'), true);
    const t = thread([
      msg({ from: owner, to: ['noreply@ticketmaster.com'] }),
      msg({ from: 'noreply@ticketmaster.com', to: [owner], subject: 'Your receipt', body: 'thanks' }),
    ]);
    const r = hardFilter(t, { ownerEmail: owner, vendorDomains: vendors });
    assert.equal(r.exclude, true);
    assert.ok(r.reason === 'noreply' || r.reason === 'noreply_subject');
  });

  it('excludes warmup tags like T3RD669 in subject or body', () => {
    const t = thread([
      msg({ from: owner, to: [school], subject: 'Quick hello T3RD669' }),
      msg({ from: school, to: [owner], body: 'hey' }),
    ]);
    const r = hardFilter(t, { ownerEmail: owner, vendorDomains: vendors });
    assert.equal(r.exclude, true);
    assert.equal(r.reason, 'warmup');
  });

  it('excludes warmup Gmail labels', () => {
    const t = thread(
      [
        msg({ from: owner, to: [school] }),
        msg({ from: school, to: [owner], body: 'interested' }),
      ],
      { labelNames: ['Email Warmup'] },
    );
    assert.equal(isWarmupThread(t), true);
    const r = hardFilter(t, { ownerEmail: owner, vendorDomains: vendors });
    assert.equal(r.reason, 'warmup');
  });
});

describe('hardFilter — keep real two-way sales threads', () => {
  it('lets a school AD reply through', () => {
    const t = thread([
      msg({ from: owner, to: [school], subject: 'Baden volleyball quote', body: 'can I send pricing?' }),
      msg({ from: school, to: [owner], subject: 'Re: Baden volleyball quote', body: 'yes please send the TF-5000 numbers' }),
    ]);
    const r = hardFilter(t, { ownerEmail: owner, vendorDomains: vendors });
    assert.equal(r.exclude, false);
    assert.equal(r.reason, null);
  });
});
