import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactToBulkLead,
  defaultOutreachStartDt,
  listNameForArea,
  fetchAllAreaContactIds,
  createOutreachBatchFromIds,
  outreachPathForBatch,
} from './prospectingOutreach.js';

describe('contactToBulkLead', () => {
  it('maps a school contact to a sendable Bulk Outreach lead', () => {
    const lead = contactToBulkLead({
      id: 'c1',
      firstName: 'Pat',
      lastName: 'Riley',
      email: 'priley@hudson.k12.ia.us',
      school: 'Hudson High School',
      sport: 'Football',
      city: 'Hudson',
      state: 'IA',
    });
    assert.equal(lead.orgName, 'Hudson High School');
    assert.equal(lead.contactName, 'Pat Riley');
    assert.equal(lead.sendable, true);
    assert.equal(lead.channel, 'Email');
    assert.deepEqual(lead.touches, []);
  });

  it('marks a missing email as not sendable', () => {
    const lead = contactToBulkLead({ id: 'c2', firstName: 'No', lastName: 'Mail', school: 'Hudson' });
    assert.equal(lead.sendable, false);
    assert.equal(lead.email, '');
  });
});

describe('listNameForArea / start', () => {
  it('names the list from the segment and the day', () => {
    assert.equal(listNameForArea({ name: 'Iowa Football' }, new Date('2026-09-03T12:00:00Z')).startsWith('Iowa Football – '), true);
  });

  it('skips the weekend for the first send morning', () => {
    const saturday = new Date(2026, 8, 5, 12, 0, 0);
    assert.equal(defaultOutreachStartDt(saturday), '2026-09-07T09:00');
    const thursday = new Date(2026, 8, 3, 12, 0, 0);
    assert.equal(defaultOutreachStartDt(thursday), '2026-09-04T09:00');
  });
});

describe('fetchAllAreaContactIds', () => {
  it('uses idsOnly when the API returns ids', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ ids: ['a', 'b', 'a'], total: 2 }),
    });
    const ids = await fetchAllAreaContactIds({ sports: ['Football'] }, {}, fetchImpl);
    assert.deepEqual(ids, ['a', 'b']);
  });

  it('pages at 100 when idsOnly is not supported', async () => {
    const fetchImpl = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.idsOnly) return { ok: true, json: async () => ({ contacts: [], total: 2 }) };
      if (body.page === 1) {
        return { ok: true, json: async () => ({ contacts: [{ id: '1' }, { id: '2' }], total: 2, pages: 1 }) };
      }
      return { ok: true, json: async () => ({ contacts: [], total: 2, pages: 1 }) };
    };
    const ids = await fetchAllAreaContactIds({ name: 'Iowa' }, {}, fetchImpl);
    assert.deepEqual(ids, ['1', '2']);
  });

  it('stops on an empty idsOnly payload instead of paging', async () => {
    const fetchImpl = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.idsOnly) return { ok: true, json: async () => ({ ids: [], idsOnly: true, total: 0 }) };
      throw new Error('should not page');
    };
    const ids = await fetchAllAreaContactIds({ name: 'Empty' }, {}, fetchImpl);
    assert.deepEqual(ids, []);
  });
});

describe('createOutreachBatchFromIds', () => {
  it('posts only emailed contacts and returns the batch id', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
      if (String(url).startsWith('/api/contacts?ids=')) {
        return {
          ok: true,
          json: async () => ({
            contacts: [
              { id: 'c1', firstName: 'A', lastName: 'One', email: 'a@x.com', companyName: 'School A' },
              { id: 'c2', firstName: 'B', lastName: 'Two', email: '', companyName: 'School B' },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true, batch: { id: 'batch-9' } }) };
    };
    const r = await createOutreachBatchFromIds({
      name: 'Iowa Football – Sep 3',
      contactIds: ['c1', 'c2'],
      createdBy: 'Matt',
      fetchImpl,
    });
    assert.equal(r.ok, true);
    assert.equal(r.batch.id, 'batch-9');
    assert.equal(r.leadCount, 1);
    const posted = calls.find(c => c.url === '/api/outreach/batches');
    assert.equal(posted.body.leads.length, 1);
    assert.equal(posted.body.batchSize, 25);
    assert.equal(posted.body.leads[0].email, 'a@x.com');
  });
});

describe('outreachPathForBatch', () => {
  it('opens Bulk Outreach on the 15-second drip setting', () => {
    assert.equal(outreachPathForBatch('abc'), '/bulk-outreach?batch=abc&pace=drip');
  });
});
