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
  schoolKeyFromAccount,
  foldPersistedAccountsIntoGroups,
  lineItemsToQuoteItems,
  zohoIdFromContact,
  mergeZohoContactRow,
  mergeContactsPreferRecentSaves,
  crmNavForDeal,
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

  it('keeps persisted/Zoho ids when folding a stub into the full school name', () => {
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
        contacts: [],
        deals: [],
        value: 0,
        invoiced: false,
        persistedId: 'acct_1',
        zohoAccountId: 'z_acc',
        city: 'Hudson',
        state: 'IA',
      },
    };
    const merged = mergeAccountGroups(groups);
    const g = merged['Hudson High School — IA'];
    assert.equal(g.persistedId, 'acct_1');
    assert.equal(g.zohoAccountId, 'z_acc');
    assert.equal(g.city, 'Hudson');
  });
});

describe('schoolKeyFromAccount + foldPersistedAccountsIntoGroups', () => {
  it('keys an account the same way as a contact at that school', () => {
    assert.equal(schoolKeyFromAccount({ name: 'Hudson High School', state: 'IA' }), 'Hudson High School — IA');
    assert.equal(schoolKeyFromAccount({ name: 'Hudson High School' }), 'Hudson High School');
    assert.equal(schoolKeyFromAccount({ name: '  ' }), '');
  });

  it('adds a zero-contact row so a newly created account is visible', () => {
    const groups = {};
    foldPersistedAccountsIntoGroups(groups, [
      { id: 'a1', name: 'New Prairie High School', city: 'New Carlisle', state: 'IN', zohoAccountId: 'z9' },
    ]);
    const g = groups['New Prairie High School — IN'];
    assert.ok(g);
    assert.equal(g.contacts.length, 0);
    assert.equal(g.zohoAccountId, 'z9');
    assert.equal(g.city, 'New Carlisle');
  });

  it('stamps Zoho id onto the existing Hudson High School row instead of adding a second account', () => {
    const groups = {
      'Hudson High School — IA': {
        name: 'Hudson High School',
        contacts: [hudsonCoach],
        deals: [],
        value: 0,
        invoiced: false,
      },
    };
    foldPersistedAccountsIntoGroups(groups, [
      { id: 'a1', name: 'Hudson', state: 'IA', zohoAccountId: 'z_h' },
    ]);
    assert.equal(Object.keys(groups).length, 1);
    assert.equal(groups['Hudson High School — IA'].zohoAccountId, 'z_h');
    assert.equal(groups['Hudson High School — IA'].persistedId, 'a1');
  });

  it('honors the search box so Tools counts stay filterable', () => {
    const groups = {};
    foldPersistedAccountsIntoGroups(groups, [
      { id: 'a1', name: 'Hudson High School', state: 'IA' },
      { id: 'a2', name: 'Lincoln High School', state: 'TX' },
    ], 'hudson');
    assert.ok(groups['Hudson High School — IA']);
    assert.equal(groups['Lincoln High School — TX'], undefined);
  });
});

describe('lineItemsToQuoteItems', () => {
  it('maps API line items to the CRM deal quote block', () => {
    const items = lineItemsToQuoteItems([{ name: 'Ball', quantity: 3, rate: 10 }]);
    assert.deepEqual(items, [{ name: 'Ball', qty: 3, rate: 10, cost: 0, description: '' }]);
  });
});

describe('zohoIdFromContact', () => {
  it('reads zohoId or the zoho_c_ / zoho_l_ prefix', () => {
    assert.equal(zohoIdFromContact({ zohoId: 'abc' }), 'abc');
    assert.equal(zohoIdFromContact({ id: 'zoho_c_999' }), '999');
    assert.equal(zohoIdFromContact({ id: 'zoho_l_888' }), '888');
    assert.equal(zohoIdFromContact({ id: 'local_1' }), null);
  });
});

describe('mergeZohoContactRow', () => {
  it('keeps a Hudson profile save that Zoho has not caught up to', () => {
    const now = 1_700_000_000_000;
    const local = {
      id: 'zoho_c_1',
      firstName: 'Kevin',
      email: 'kevin@hudson.k12.ia.us',
      phone: '319-555-0100',
      school: 'Hudson High School',
      profileSavedAt: now - 60_000,
    };
    const incoming = {
      id: 'zoho_c_1',
      firstName: 'Kev',
      email: 'old@hudson.k12.ia.us',
      phone: '',
      school: 'Hudson',
      zohoId: '1',
    };
    const merged = mergeZohoContactRow(local, incoming, now);
    assert.equal(merged.email, 'kevin@hudson.k12.ia.us');
    assert.equal(merged.phone, '319-555-0100');
    assert.equal(merged.school, 'Hudson High School');
    assert.equal(merged.zohoId, '1');
  });

  it('takes Zoho once the save window expires', () => {
    const now = 1_700_000_000_000;
    const merged = mergeZohoContactRow(
      { id: 'zoho_c_1', email: 'new@x.com', profileSavedAt: now - 20 * 60 * 1000 },
      { id: 'zoho_c_1', email: 'zoho@x.com', zohoId: '1' },
      now,
    );
    assert.equal(merged.email, 'zoho@x.com');
  });
});

describe('mergeContactsPreferRecentSaves', () => {
  it('keeps server membership and overlays a recent local save', () => {
    const now = 1_700_000_000_000;
    const out = mergeContactsPreferRecentSaves(
      [{ id: 'zoho_c_1', email: 'new@x.com', profileSavedAt: now - 1000 }],
      [{ id: 'zoho_c_1', email: 'old@x.com' }, { id: 'zoho_c_2', email: 'other@x.com' }],
      now,
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].email, 'new@x.com');
    assert.equal(out[1].email, 'other@x.com');
  });
});

describe('crmNavForDeal', () => {
  it('opens the Hudson coach deal tab when the deal has a contactId', () => {
    const nav = crmNavForDeal(
      { id: 'd1', contactId: 'c_hudson_ad', school: 'Hudson', state: 'IA' },
      [hudsonCoach],
    );
    assert.equal(nav.id, 'c_hudson_ad');
    assert.equal(nav.tab, 'deal');
    assert.equal(nav.school, 'Hudson High School — IA');
  });

  it('falls back to the school page when there is no contact', () => {
    const nav = crmNavForDeal({ id: 'd2', school: 'Hudson High School', state: 'IA' }, []);
    assert.equal(nav.id, undefined);
    assert.equal(nav.school, 'Hudson High School — IA');
    assert.equal(nav.tab, 'deal');
  });
});
