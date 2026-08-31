import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickBestZohoAccount, zohoAccountSearchWord } from './zohoAccountMatch.js';

describe('pickBestZohoAccount', () => {
  const hudsonHs = { id: '1', Account_Name: 'Hudson High School', Billing_State: 'IA' };
  const hudsonValley = { id: '2', Account_Name: 'Hudson Valley Academy', Billing_State: 'NY' };
  const exactHudson = { id: '3', Account_Name: 'Hudson', Billing_State: 'IA' };

  it('maps Hudson to Hudson High School when that is the only Iowa hit', () => {
    const hit = pickBestZohoAccount([hudsonHs, hudsonValley], 'Hudson', 'IA');
    assert.equal(hit.id, '1');
  });

  it('prefers an exact Account_Name match', () => {
    const hit = pickBestZohoAccount([hudsonHs, exactHudson], 'Hudson', 'IA');
    assert.equal(hit.id, '3');
  });

  it('returns null when nothing looks like the typed name', () => {
    assert.equal(pickBestZohoAccount([{ id: '9', Account_Name: 'Lincoln High School' }], 'Hudson'), null);
  });
});

describe('zohoAccountSearchWord', () => {
  it('uses the first word for a starts_with search', () => {
    assert.equal(zohoAccountSearchWord('Hudson High School'), 'Hudson');
    assert.equal(zohoAccountSearchWord('HS'), '');
  });
});
