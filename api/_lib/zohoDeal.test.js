import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isScopeError, zohoDealStage } from './zohoDeal.js';

describe('zohoDealStage', () => {
  it('maps Quoted to the Zoho proposal stage', () => {
    assert.equal(zohoDealStage('Quoted'), 'Proposal/Price Quote');
  });
});

describe('isScopeError', () => {
  it('detects Zoho oauth / auto scope failures', () => {
    assert.equal(isScopeError({ code: 'OAUTH_SCOPE_MISMATCH', message: 'invalid oauth scope' }), true);
    assert.equal(isScopeError({ message: 'invalid auto scope' }), true);
    assert.equal(isScopeError({ message: 'duplicate data' }), false);
  });
});
