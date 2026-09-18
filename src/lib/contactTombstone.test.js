import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyContactTombstones,
  contactIsSuppressed,
  filterLiveContacts,
  mergeIdLists,
  suppressFromRemovedContacts,
  unionContacts,
} from './contactTombstone.js';

describe('contactIsSuppressed', () => {
  it('tombstones a local id and a Zoho id even after a merge revives the row', () => {
    const suppress = { suppressedContactIds: ['c1'], suppressedContactZohoIds: ['z9'] };
    assert.equal(contactIsSuppressed({ id: 'c1', fullName: 'Parker Kennedy' }, suppress), true);
    assert.equal(contactIsSuppressed({ id: 'zoho_c_z9', fullName: 'Parker Kennedy' }, suppress), true);
    assert.equal(contactIsSuppressed({ id: 'other', zohoId: 'z9' }, suppress), true);
    assert.equal(contactIsSuppressed({ id: 'keep', zohoId: 'live' }, suppress), false);
  });
});

describe('suppressFromRemovedContacts', () => {
  it('records both the local id and the Zoho id on delete', () => {
    const gone = [{ id: 'zoho_c_z9', fullName: 'Parker Kennedy' }];
    const t = suppressFromRemovedContacts(gone, ['zoho_c_z9']);
    assert.deepEqual(t.suppressedContactIds, ['zoho_c_z9']);
    assert.deepEqual(t.suppressedContactZohoIds, ['z9']);
  });
});

describe('unionContacts', () => {
  it('keeps a contact only one side currently knows about', () => {
    const previous = [{ id: 'zoho_c_1', fullName: 'Parker Kennedy' }, { id: 'shared', fullName: 'Old copy' }];
    const incoming = [{ id: 'shared', fullName: 'Edited elsewhere' }];
    const merged = unionContacts(previous, incoming);
    const ids = merged.map(c => c.id).sort();
    assert.deepEqual(ids, ['shared', 'zoho_c_1']);
    // Same-id conflict: the incoming (posting) copy wins.
    assert.equal(merged.find(c => c.id === 'shared').fullName, 'Edited elsewhere');
  });
});

describe('applyContactTombstones', () => {
  it('never shrinks tombstones when a stale client posts without them', () => {
    const previous = { suppressedContactIds: ['c1'], suppressedContactZohoIds: ['z9'], contacts: [] };
    const incoming = { suppressedContactIds: [], contacts: [{ id: 'c1', fullName: 'Parker Kennedy', zohoId: 'z9' }, { id: 'keep' }] };
    const next = applyContactTombstones(incoming, previous);
    assert.deepEqual(next.suppressedContactIds, ['c1']);
    assert.deepEqual(next.suppressedContactZohoIds, ['z9']);
    assert.equal(next.contacts.length, 1);
    assert.equal(next.contacts[0].id, 'keep');
  });

  it('keeps a contact a stale posting device never had in its own snapshot — the reported "Parker Kennedy disappears" bug', () => {
    // Device A has Parker Kennedy synced from Zoho; Device B hasn't pulled
    // since before Parker existed there, so its POST only carries its own
    // (Parker-less) contacts snapshot. That must not wipe out a contact
    // only Device A knows about.
    const previous = { contacts: [{ id: 'zoho_c_parker', fullName: 'Parker Kennedy' }, { id: 'shared', fullName: 'Old copy' }] };
    const incoming = { contacts: [{ id: 'shared', fullName: 'Edited on device B' }] };
    const next = applyContactTombstones(incoming, previous);
    const ids = next.contacts.map(c => c.id).sort();
    assert.deepEqual(ids, ['shared', 'zoho_c_parker']);
    assert.equal(next.contacts.find(c => c.id === 'shared').fullName, 'Edited on device B');
  });

  it('a real removal (tombstoned) stays gone even though union would otherwise revive it', () => {
    const previous = { contacts: [{ id: 'zoho_c_gone', zohoId: 'z1' }] };
    const incoming = {
      contacts: [],
      suppressedContactIds: ['zoho_c_gone'],
      suppressedContactZohoIds: ['z1'],
    };
    const next = applyContactTombstones(incoming, previous);
    assert.equal(next.contacts.length, 0);
  });
});

describe('filterLiveContacts / mergeIdLists', () => {
  it('unions tombstones from local and server', () => {
    assert.deepEqual(mergeIdLists(['a'], ['a', 'b'], null), ['a', 'b']);
  });

  it('drops a suppressed contact from an otherwise-unioned list', () => {
    const contacts = [{ id: 'c1' }, { id: 'c2' }];
    const out = filterLiveContacts(contacts, { suppressedContactIds: ['c1'] });
    assert.deepEqual(out.map(c => c.id), ['c2']);
  });
});
