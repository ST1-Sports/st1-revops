import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeById } from './appStateSync.js';
import {
  applyDealTombstones,
  dealIsOrphanLocal,
  dealIsReal,
  dealIsSuppressed,
  filterLiveDeals,
  filterRealDeals,
  mergeIdLists,
  suppressFromRemovedDeals,
  zohoIdFromDeal,
} from './dealTombstone.js';

describe('zohoIdFromDeal', () => {
  it('reads zohoId, or the zoho_d_ prefix used by Integrations imports', () => {
    assert.equal(zohoIdFromDeal({ zohoId: '555' }), '555');
    assert.equal(zohoIdFromDeal({ id: 'zoho_d_555' }), '555');
    assert.equal(zohoIdFromDeal({ id: 'local_1' }), null);
  });
});

describe('dealIsSuppressed', () => {
  it('tombstones a local id and a Zoho id even after merge revives the row', () => {
    const suppress = { suppressedDealIds: ['d1'], suppressedDealZohoIds: ['z9'] };
    assert.equal(dealIsSuppressed({ id: 'd1', name: 'Hudson' }, suppress), true);
    assert.equal(dealIsSuppressed({ id: 'zoho_d_z9', name: 'Hudson' }, suppress), true);
    assert.equal(dealIsSuppressed({ id: 'other', zohoId: 'z9' }, suppress), true);
    assert.equal(dealIsSuppressed({ id: 'keep', zohoId: 'live' }, suppress), false);
  });
});

describe('filter after mergeById', () => {
  it('drops a deleted deal that a stale server snapshot still has', () => {
    const local = [];
    const server = [{ id: 'd1', name: 'Hudson — ST1-1', zohoId: 'z9' }];
    const suppress = {
      suppressedDealIds: ['d1'],
      suppressedDealZohoIds: ['z9'],
    };
    const merged = filterLiveDeals(mergeById(local, server), suppress);
    assert.equal(merged.length, 0);
  });

  it('records both the local id and the Zoho id on delete', () => {
    const gone = [{ id: 'zoho_d_z9', name: 'Hudson' }];
    const t = suppressFromRemovedDeals(gone, ['zoho_d_z9']);
    assert.deepEqual(t.suppressedDealIds, ['zoho_d_z9']);
    assert.deepEqual(t.suppressedDealZohoIds, ['z9']);
  });
});

describe('mergeIdLists', () => {
  it('unions tombstones from local and server', () => {
    assert.deepEqual(mergeIdLists(['a'], ['a', 'b'], null), ['a', 'b']);
  });
});

describe('dealIsReal / orphans', () => {
  const suppress = { suppressedDealIds: ['gone'], suppressedDealZohoIds: [] };
  it('keeps Zoho-linked, pending creates, and quote-sourced deals', () => {
    assert.equal(dealIsReal({ id: 'z', zohoId: '1' }, suppress), true);
    assert.equal(dealIsReal({ id: 'p', zoho_synced: false }, suppress), true);
    assert.equal(dealIsReal({ id: 'q', source: 'scout-quote' }, suppress), true);
    assert.equal(dealIsReal({ id: 'm', source: 'manual' }, suppress), true);
    assert.equal(dealIsReal({ id: 'u', source: 'uploaded-quote' }, suppress), true);
    assert.equal(dealIsReal({ id: 'gone', zohoId: '1' }, suppress), false);
  });
  it('treats old campaign leftovers with no Zoho id as orphans', () => {
    const dudley = { id: '7ye32nt', name: 'Dudley Softballs — Greene County', notes: 'From campaign: Blitz' };
    assert.equal(dealIsOrphanLocal(dudley), true);
    assert.equal(dealIsReal(dudley, {}), false);
    assert.equal(filterRealDeals([dudley, { id: 'keep', zohoId: '9' }], {}).map(d => d.id).join(), 'keep');
  });
});

describe('applyDealTombstones', () => {
  it('never shrinks tombstones when a stale client posts without them', () => {
    const previous = { suppressedDealIds: ['d1'], suppressedDealZohoIds: ['z9'], deals: [] };
    const incoming = { suppressedDealIds: [], deals: [{ id: 'd1', name: 'Hudson', zohoId: 'z9' }, { id: 'keep', zohoId: 'live' }] };
    const next = applyDealTombstones(incoming, previous);
    assert.deepEqual(next.suppressedDealIds, ['d1']);
    assert.deepEqual(next.suppressedDealZohoIds, ['z9']);
    assert.equal(next.deals.length, 1);
    assert.equal(next.deals[0].id, 'keep');
  });
});
