import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  orgNamesMatch,
  resolveQuoteCrmTarget,
  dealBelongsToSchool,
  dealBelongsToContact,
  contactBelongsToSchoolKey,
  buildLocalQuoteDeal,
  findExistingQuoteDeal,
  mergeAccountGroups,
  attachOpenDealsToAccountGroups,
  lineItemsToQuoteItems,
} from './quoteCrmLink.js';

const hudsonCoach = {
  id: 'c_hudson_ad',
  fullName: 'Pat Riley',
  firstName: 'Pat',
  lastName: 'Riley',
  email: 'priley@hudson.k12.ia.us',
  school: 'Hudson High School',
  city: 'Hudson',
  state: 'IA',
};

describe('orgNamesMatch', () => {
  it('treats Hudson as Hudson High School', () => {
    assert.equal(orgNamesMatch('Hudson', 'Hudson High School'), true);
    assert.equal(orgNamesMatch('hudson high school', 'Hudson'), true);
  });

  it('does not merge different schools that do not contain each other', () => {
    assert.equal(orgNamesMatch('Lincoln High School', 'Lincoln Middle School'), false);
    assert.equal(orgNamesMatch('Iowa', 'Iowa City High'), false);
  });
});

describe('resolveQuoteCrmTarget', () => {
  it('rewrites a short school name onto the existing Hudson account and contact', () => {
    const t = resolveQuoteCrmTarget([hudsonCoach], {
      school: 'Hudson',
      contact: 'Pat Riley',
      email: '',
    });
    assert.equal(t.school, 'Hudson High School');
    assert.equal(t.state, 'IA');
    assert.equal(t.city, 'Hudson');
    assert.equal(t.contactId, 'c_hudson_ad');
    assert.equal(t.contactName, 'Pat Riley');
    assert.equal(t.isNewContact, false);
    assert.equal(t.schoolKey, 'Hudson High School — IA');
  });

  it('still resolves the school when the coach field is blank', () => {
    const t = resolveQuoteCrmTarget([hudsonCoach], { school: 'Hudson' });
    assert.equal(t.school, 'Hudson High School');
    assert.equal(t.contactId, '');
    assert.equal(t.isNewContact, false);
  });

  it('matches the person by email even if the typed school is short', () => {
    const t = resolveQuoteCrmTarget([hudsonCoach], {
      school: 'Hudson',
      email: 'priley@hudson.k12.ia.us',
    });
    assert.equal(t.contactId, 'c_hudson_ad');
    assert.equal(t.email, 'priley@hudson.k12.ia.us');
  });

  it('flags a brand-new coach so the caller can add them under the resolved school', () => {
    const t = resolveQuoteCrmTarget([hudsonCoach], {
      school: 'Hudson',
      contact: 'New Coach',
      email: 'new@hudson.k12.ia.us',
    });
    assert.equal(t.school, 'Hudson High School');
    assert.equal(t.isNewContact, true);
    assert.equal(t.contactId, '');
  });
});

describe('dealBelongsToSchool / contactBelongsToSchoolKey', () => {
  it('shows a deal typed as Hudson on the Hudson High School record', () => {
    const deal = { id: 'd1', school: 'Hudson', contact: '', value: 95, stage: 'Quoted' };
    assert.equal(dealBelongsToSchool(deal, [hudsonCoach], 'Hudson High School'), true);
  });

  it('shows a deal linked by contactId even when school is blank', () => {
    const deal = { id: 'd2', school: '', contactId: 'c_hudson_ad', stage: 'Quoted' };
    assert.equal(dealBelongsToSchool(deal, [hudsonCoach], 'Hudson High School'), true);
  });

  it('puts a school-only Hudson deal on every Hudson coach', () => {
    const deal = { id: 'd3', school: 'Hudson', contact: '', contactId: '', stage: 'Quoted' };
    assert.equal(dealBelongsToContact(deal, hudsonCoach), true);
    assert.equal(dealBelongsToContact(deal, { ...hudsonCoach, id: 'other', school: 'Lincoln High School' }), false);
  });

  it('does not pin a named coach deal onto a different Hudson contact', () => {
    const deal = { id: 'd4', school: 'Hudson High School', contact: 'Pat Riley', contactId: 'c_hudson_ad' };
    assert.equal(dealBelongsToContact(deal, { id: 'c_other', fullName: 'Other Coach', school: 'Hudson High School', state: 'IA' }), false);
  });

  it('keeps a Texas Lincoln deal off an Iowa Lincoln account', () => {
    const ia = { id: 'c_ia', fullName: 'Ada', school: 'Lincoln High School', state: 'IA' };
    assert.equal(contactBelongsToSchoolKey(ia, 'Lincoln High School — TX'), false);
    assert.equal(contactBelongsToSchoolKey(ia, 'Lincoln High School — IA'), true);
    assert.equal(contactBelongsToSchoolKey({ ...ia, school: 'Lincoln' }, 'Lincoln High School — IA'), true);
  });
});

describe('buildLocalQuoteDeal', () => {
  it('copies chat line items onto the deal the CRM quote tab reads', () => {
    const resolved = resolveQuoteCrmTarget([hudsonCoach], { school: 'Hudson', contact: 'Pat Riley' });
    const deal = buildLocalQuoteDeal({
      id: 'd_new',
      quoteNumber: 'ST1-20260831-ABCD',
      resolved,
      lineItems: [{ name: 'TF-5000', quantity: 2, rate: 94.99, cost: 58.89 }],
      notes: 'Fall bid',
      zohoId: 'z123',
      createdAt: '2026-08-31',
    });
    assert.equal(deal.school, 'Hudson High School');
    assert.equal(deal.contactId, 'c_hudson_ad');
    assert.equal(deal.quoteNumber, 'ST1-20260831-ABCD');
    assert.equal(deal.quoteItems.length, 1);
    assert.equal(deal.quoteItems[0].qty, 2);
    assert.equal(deal.quoteItems[0].rate, 94.99);
    assert.equal(deal.value, 189.98);
    assert.equal(deal.quoteNotes, 'Fall bid');
    assert.match(deal.notes, /TF-5000/);
  });
});

describe('findExistingQuoteDeal', () => {
  it('only matches the same quote number, not a 6-character school prefix', () => {
    const deals = [
      { id: 'other', name: 'Hudson Valley Academy — old', school: 'Hudson Valley Academy' },
      { id: 'hit', quoteNumber: 'ST1-1', school: 'Hudson High School' },
    ];
    assert.equal(findExistingQuoteDeal(deals, 'ST1-1')?.id, 'hit');
    assert.equal(findExistingQuoteDeal(deals, 'ST1-2'), null);
  });
});

describe('mergeAccountGroups + attachOpenDealsToAccountGroups', () => {
  it('folds a stub Hudson row into Hudson High School and attaches the chat deal', () => {
    const groups = {
      'Hudson High School — IA': {
        name: 'Hudson High School',
        contacts: [hudsonCoach],
        deals: [],
        value: 0,
        invoiced: false,
      },
      Hudson: {
        name: 'Hudson',
        contacts: [{ id: 'c_stub', fullName: 'Quote Lead', school: 'Hudson' }],
        deals: [],
        value: 0,
        invoiced: false,
      },
    };
    const merged = mergeAccountGroups(groups);
    assert.equal(Object.keys(merged).length, 1);
    const g = merged['Hudson High School — IA'];
    assert.ok(g);
    assert.equal(g.contacts.length, 2);
    attachOpenDealsToAccountGroups(merged, [
      { id: 'd_chat', school: 'Hudson', value: 95, stage: 'Quoted', quoteNumber: 'ST1-9' },
    ]);
    assert.equal(g.deals.length, 1);
    assert.equal(g.deals[0].quoteNumber, 'ST1-9');
    assert.equal(g.value, 95);
  });

  it('does not fold same-named schools in different states', () => {
    const groups = {
      'Lincoln High School — IA': { name: 'Lincoln High School', contacts: [{ id: 'ia', school: 'Lincoln High School', state: 'IA' }], deals: [], value: 0 },
      'Lincoln High School — TX': { name: 'Lincoln High School', contacts: [{ id: 'tx', school: 'Lincoln High School', state: 'TX' }], deals: [], value: 0 },
    };
    assert.equal(Object.keys(mergeAccountGroups(groups)).length, 2);
  });
});

describe('lineItemsToQuoteItems', () => {
  it('maps API line items to the CRM quote-tab shape', () => {
    const items = lineItemsToQuoteItems([{ name: 'Ball', quantity: 3, rate: 10 }]);
    assert.deepEqual(items, [{ name: 'Ball', qty: 3, rate: 10, cost: 0, description: '' }]);
  });
});
