import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  csvEscape,
  sentRowsFromBatches,
  uniqueSentByEmail,
  toCsv,
  SENT_UNIQUE_HEADERS,
  effectiveBatchStatus,
  claimedEmails,
  applyFirstUploadHolds,
  applyLeadOutcome,
  leadStoppedAuto,
  stoppedLeadForEmail,
} from './outreachSent.js';

describe('sentRowsFromBatches', () => {
  const batches = [
    {
      name: 'Iowa AD',
      status: 'draft',
      leads: [
        {
          email: 'ad@lincoln.k12.ia.us',
          orgName: 'Lincoln High',
          contactName: 'Pat Lee',
          sport: 'Basketball',
          city: 'Lincoln',
          state: 'IA',
          touches: [
            { subject: 'Lincoln stores', body: 'hi', sentAt: '2026-08-27T12:00:00.000Z' },
            { subject: 'Follow up', body: 'ping' },
          ],
        },
        {
          email: 'skip@example.com',
          orgName: 'Never Sent',
          touches: [{ subject: 'Draft', body: 'no' }],
        },
      ],
    },
    {
      name: 'Basketball 500',
      status: 'draft',
      leads: [
        {
          email: 'AD@lincoln.k12.ia.us',
          orgName: 'Lincoln HS',
          firstName: 'Pat',
          lastName: 'Lee',
          bounced: true,
          touches: [{ subject: 'Hoops', body: 'hi', sentAt: '2026-09-01T22:00:00.000Z' }],
        },
      ],
    },
  ];

  it('keeps only touches that already went out', () => {
    const rows = sentRowsFromBatches(batches);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.email_key), ['ad@lincoln.k12.ia.us', 'ad@lincoln.k12.ia.us']);
    assert.equal(rows.some(r => r.email === 'skip@example.com'), false);
  });

  it('never includes a row that has not actually been emailed', () => {
    const rows = sentRowsFromBatches([{
      name: 'Open list',
      leads: [
        { email: 'queued@school.org', orgName: 'Queued', touches: [{ subject: 'Hi', sentAt: true }] },
        { email: 'blank@school.org', orgName: 'Blank', touches: [{ subject: 'Hi', sentAt: '' }] },
        { email: 'real@school.org', orgName: 'Real', touches: [{ subject: 'Hi', sentAt: '2026-09-02T12:00:00.000Z' }] },
      ],
    }]);
    assert.deepEqual(rows.map(r => r.email), ['real@school.org']);
  });

  it('collapses to one email for a new-sheet dedupe', () => {
    const uniq = uniqueSentByEmail(sentRowsFromBatches(batches));
    assert.equal(uniq.length, 1);
    assert.equal(uniq[0].email, 'AD@lincoln.k12.ia.us');
    assert.equal(uniq[0].send_count, 2);
    assert.equal(uniq[0].last_touch, 1);
    assert.equal(uniq[0].bounced, 'yes');
    assert.match(uniq[0].batches, /Iowa AD/);
    assert.match(uniq[0].batches, /Basketball 500/);
  });
});

describe('effectiveBatchStatus', () => {
  it('stays draft until something is sent, then becomes active', () => {
    const draft = { status: 'draft', leads: [{ touches: [{ subject: 'Hi' }] }] };
    assert.equal(effectiveBatchStatus(draft), 'draft');
    assert.equal(effectiveBatchStatus({
      status: 'draft',
      leads: [{ touches: [{ subject: 'Hi', sentAt: '2026-09-01T12:00:00.000Z' }] }],
    }), 'active');
  });

  it('does not drop an approved campaign back to active', () => {
    assert.equal(effectiveBatchStatus({
      status: 'approved',
      leads: [{ touches: [{ sentAt: '2026-09-01T12:00:00.000Z' }] }],
    }), 'approved');
  });
});

describe('first-upload priority', () => {
  const iowa = {
    id: 'iowa',
    name: 'Iowa AD',
    createdAt: '2026-08-27T00:00:00.000Z',
    status: 'active',
    leads: [
      { email: 'ad@lincoln.k12.ia.us', orgName: 'Lincoln', sendable: true, touches: [{ sentAt: '2026-08-28T12:00:00.000Z' }] },
      { email: 'pending@iowa.edu', orgName: 'Pending HS', sendable: true, touches: [{ subject: 'Hi' }] },
    ],
  };
  const hoops = {
    id: 'hoops',
    name: 'Basketball 500',
    createdAt: '2026-09-01T00:00:00.000Z',
    status: 'active',
    leads: [
      { email: 'ad@lincoln.k12.ia.us', orgName: 'Lincoln HS', sendable: true, touches: [{ sentAt: '2026-09-01T22:00:00.000Z' }] },
      { email: 'pending@iowa.edu', orgName: 'Pending HS', sendable: true, touches: [{ subject: 'Hoops' }] },
      { email: 'new@school.org', orgName: 'New School', sendable: true, touches: [{ subject: 'Hi' }] },
    ],
  };

  it('lets the earlier active list keep the email', () => {
    const claims = claimedEmails([hoops, iowa]);
    assert.equal(claims.get('ad@lincoln.k12.ia.us').batchId, 'iowa');
    assert.equal(claims.get('pending@iowa.edu').batchId, 'iowa');
    assert.equal(claims.get('new@school.org').batchId, 'hoops');
  });

  it('removes later-list people the earlier list already owns', () => {
    const claims = claimedEmails([iowa, hoops]);
    const { leads, changed } = applyFirstUploadHolds(hoops.leads, 'hoops', claims);
    assert.equal(changed, 2);
    assert.equal(leads.find(l => l.email === 'pending@iowa.edu').heldForEarlier, true);
    assert.equal(leads.find(l => l.email === 'pending@iowa.edu').sendable, false);
    assert.equal(leads.find(l => l.email === 'ad@lincoln.k12.ia.us').heldByBatch, 'Iowa AD');
    assert.equal(leads.find(l => l.email === 'new@school.org').heldForEarlier, undefined);
    assert.equal(leads.find(l => l.email === 'new@school.org').sendable, true);
  });

  it('does not let a leftover draft claim an address', () => {
    const draft = {
      id: 'colorado',
      name: 'Colorado READY',
      createdAt: '2026-08-01T00:00:00.000Z',
      status: 'draft',
      leads: [{ email: 'ad@lincoln.k12.ia.us', sendable: true, touches: [{ subject: 'Hi' }] }],
    };
    const claims = claimedEmails([draft, iowa, hoops]);
    assert.equal(claims.get('ad@lincoln.k12.ia.us').batchId, 'iowa');
    assert.equal(claims.has('only-on-draft@x.com'), false);
  });

  it('matches emails case-insensitively and is idempotent', () => {
    const later = {
      id: 'hoops',
      name: 'Basketball 500',
      createdAt: '2026-09-01T00:00:00.000Z',
      status: 'active',
      leads: [{ email: 'AD@Lincoln.k12.ia.us', sendable: true, touches: [{ subject: 'Hoops' }] }],
    };
    const claims = claimedEmails([iowa, later]);
    assert.equal(claims.get('ad@lincoln.k12.ia.us').batchId, 'iowa');
    const first = applyFirstUploadHolds(later.leads, 'hoops', claims);
    const second = applyFirstUploadHolds(first.leads, 'hoops', claims);
    assert.equal(first.changed, 1);
    assert.equal(second.changed, 0);
    assert.equal(second.leads[0].heldForEarlier, true);
  });

  it('clears a hold if the earlier list no longer owns the email', () => {
    const held = [{
      email: 'pending@iowa.edu',
      sendable: false,
      heldForEarlier: true,
      heldByBatch: 'Iowa AD',
      heldByBatchId: 'iowa',
    }];
    const { leads, changed } = applyFirstUploadHolds(held, 'hoops', new Map());
    assert.equal(changed, 1);
    assert.equal(leads[0].heldForEarlier, false);
    assert.equal(leads[0].sendable, true);
  });
});

describe('lead outcomes', () => {
  it('stops automated follow-ups for intent and manual, and clears them', () => {
    const lead = { email: 'ad@lincoln.k12.ia.us', sendable: true, touches: [{ sentAt: '2026-09-01T12:00:00.000Z' }, { subject: 'Follow' }] };
    const intent = applyLeadOutcome(lead, 'intent');
    assert.equal(intent.positiveIntent, true);
    assert.equal(intent.manualFollowUp, false);
    assert.equal(leadStoppedAuto(intent), true);
    const manual = applyLeadOutcome(intent, 'manual');
    assert.equal(manual.manualFollowUp, true);
    assert.equal(manual.positiveIntent, false);
    const cleared = applyLeadOutcome(manual, null);
    assert.equal(leadStoppedAuto(cleared), false);
  });

  it('finds a stopped lead on a batch so send paths can skip them', () => {
    const batches = [{
      id: 'hoops',
      name: 'Basketball 500',
      leads: [{ email: 'ad@lincoln.k12.ia.us', positiveIntent: true }],
    }];
    const hit = stoppedLeadForEmail(batches, 'AD@lincoln.k12.ia.us', 'hoops');
    assert.equal(hit.outcome, 'intent');
    assert.equal(stoppedLeadForEmail(batches, 'other@x.com', 'hoops'), null);
  });
});

describe('csvEscape / toCsv', () => {
  it('quotes commas and quotes', () => {
    assert.equal(csvEscape('Lee, Pat'), '"Lee, Pat"');
    assert.equal(csvEscape('He said "hi"'), '"He said ""hi"""');
    const csv = toCsv(SENT_UNIQUE_HEADERS, [{
      email: 'a@b.com', org: 'Lincoln, IA', contact: '', sport: '', city: '', state: 'IA',
      last_sent_at: '2026-09-01', last_touch: 1, send_count: 1, last_subject: 'Hi', bounced: '', batches: 'Iowa',
    }]);
    assert.match(csv, /"Lincoln, IA"/);
    assert.match(csv, /^email,org,contact,/);
  });
});
