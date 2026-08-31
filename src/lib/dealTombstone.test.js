import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeById } from './appStateSync.js';
import {
  dealIsSuppressed,
  filterLiveDeals,
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
