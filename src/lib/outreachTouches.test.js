import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  touchHasCopy,
  mergeLeadTags,
  effectiveTouch,
  needsEmail1Composer,
  stepIndicesFor,
  countPendingTouches,
  batchScheduleSummary,
  clampGoBatchSize,
  goBatchPreview,
  materializeLeadsFromTemplates,
  buildOutreachSchedule,
} from './outreachTouches.js';

const lead = {
  id: '1',
  orgName: 'Hudson High',
  contactName: 'Pat Riley',
  firstName: 'Pat',
  email: 'pat@school.edu',
  sport: 'Football',
  sendable: true,
  touches: [],
};

describe('effectiveTouch', () => {
  it('uses step0 template when lead has no touches', () => {
    const templates = { step0: { subject: 'Hi {{firstName}}', body: 'Hello {{orgName}}' } };
    const t = effectiveTouch(lead, 0, templates);
    assert.equal(t.subject, 'Hi Pat');
    assert.match(t.body, /Hudson High/);
  });

  it('prefers inline copy over template', () => {
    const templates = { step0: { subject: 'Template', body: 'Template body' } };
    const withInline = { ...lead, touches: [{ subject: 'Custom', body: 'Custom body' }] };
    const t = effectiveTouch(withInline, 0, templates);
    assert.equal(t.subject, 'Custom');
  });
});

describe('needsEmail1Composer', () => {
  it('is true for prospecting lists with empty touches', () => {
    assert.equal(needsEmail1Composer([lead], {}, 'Prospecting: Track coaches'), true);
  });

  it('is false once step0 template has copy', () => {
    const templates = { step0: { subject: 'Hi', body: 'There' } };
    assert.equal(needsEmail1Composer([lead], templates, 'Prospecting: Track coaches'), false);
  });
});

describe('stepIndicesFor', () => {
  it('includes step 0 from template alone', () => {
    assert.deepEqual(stepIndicesFor([lead], { step0: { subject: 'A', body: 'B' } }), [0]);
  });
});

describe('countPendingTouches', () => {
  it('counts template-only Email 1', () => {
    const n = countPendingTouches([lead], { step0: { subject: 'Hi', body: 'Body' } });
    assert.equal(n, 1);
  });
});

describe('batchScheduleSummary', () => {
  it('computes days from sendable count and batch size', () => {
    const s = batchScheduleSummary(7000, 25);
    assert.equal(s.perDay, 25);
    assert.equal(s.daysPerTouch, 280);
  });
});

describe('clampGoBatchSize', () => {
  it('caps this GO at remaining ready count', () => {
    assert.equal(clampGoBatchSize(25, 7797), 25);
    assert.equal(clampGoBatchSize(10000, 7797), 7797);
    assert.equal(clampGoBatchSize(0, 7797), 25);
    assert.equal(clampGoBatchSize(50, 10), 10);
    assert.equal(clampGoBatchSize(25, 0), 0);
  });
});

describe('goBatchPreview', () => {
  it('shows remaining after this GO', () => {
    const p = goBatchPreview(7797, 25);
    assert.equal(p.thisGo, 25);
    assert.equal(p.remaining, 7772);
    assert.equal(p.dripMins, 7);
  });
});

describe('buildOutreachSchedule', () => {
  it('schedules template-only leads in batches', () => {
    const templates = { step0: { subject: 'Hi', body: 'Hello' } };
    const startMs = Date.UTC(2026, 8, 7, 15, 0, 0);
    const { scheduledBatches, perLeadDates } = buildOutreachSchedule('camp1', [lead, { ...lead, id: '2', email: 'b@school.edu' }], {
      startMs,
      batchSize: 1,
      touchGapDays: 5,
      templates,
    });
    assert.equal(Object.keys(scheduledBatches).length, 2);
    assert.ok(perLeadDates['1'][0]);
    assert.ok(perLeadDates['2'][0]);
  });
});

describe('materializeLeadsFromTemplates', () => {
  it('writes template copy onto empty touches', () => {
    const out = materializeLeadsFromTemplates([lead], { step0: { subject: 'Hi {{firstName}}', body: 'Hey' } });
    assert.equal(out[0].touches[0].subject, 'Hi Pat');
    assert.equal(out[0].touches[0].body, 'Hey');
  });
});

describe('mergeLeadTags', () => {
  it('fills org and first name tokens', () => {
    const text = mergeLeadTags('{{orgName}} / {{firstName}}', lead);
    assert.match(text, /Hudson High/);
    assert.match(text, /Pat/);
  });
});

describe('touchHasCopy', () => {
  it('rejects placeholder body', () => {
    assert.equal(touchHasCopy({ subject: 'A', body: '(personalized per organization)' }), false);
  });
});
