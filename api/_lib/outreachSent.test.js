import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  csvEscape,
  sentRowsFromBatches,
  uniqueSentByEmail,
  toCsv,
  SENT_UNIQUE_HEADERS,
  effectiveBatchStatus,
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
