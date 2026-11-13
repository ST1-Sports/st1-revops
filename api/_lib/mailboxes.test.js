import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyGmailError } from '../mailboxes.js';

describe('friendlyGmailError', () => {
  it('explains the old-Google-app failure instead of showing raw JSON', () => {
    const raw = 'Gmail token refresh failed: {"error":"unauthorized_client","error_description":"Unauthorized"}';
    assert.equal(friendlyGmailError(raw), 'Connected under the old Google app. Reconnect it.');
  });
  it('handles revoked tokens and missing connections', () => {
    assert.match(friendlyGmailError('Gmail token refresh failed: {"error":"invalid_grant"}'), /Reconnect/);
    assert.equal(friendlyGmailError('Company mailbox not connected — an admin can connect it'), 'Not connected.');
    assert.equal(friendlyGmailError(''), 'Not working.');
  });
});
