import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMimeWord, encodeMailbox } from './mimeHeader.js';

describe('encodeMimeWord', () => {
  it('leaves an ASCII quote subject alone', () => {
    assert.equal(encodeMimeWord('Your quote from ST1 Sports - ST1-20260831-B03B'), 'Your quote from ST1 Sports - ST1-20260831-B03B');
  });

  it('RFC 2047-encodes an em dash so it cannot show up as mojibake', () => {
    const encoded = encodeMimeWord('Your quote from ST1 Sports — ST1-1');
    assert.match(encoded, /^=\?UTF-8\?B\?/);
    assert.equal(encoded.includes('—'), false);
    assert.equal(encoded.includes('Ã'), false);
    const b64 = encoded.slice('=?UTF-8?B?'.length, -2);
    assert.equal(Buffer.from(b64, 'base64').toString('utf8'), 'Your quote from ST1 Sports — ST1-1');
  });
});

describe('encodeMailbox', () => {
  it('formats a simple From / Reply-To', () => {
    assert.equal(encodeMailbox('Matt Stone', 'matt@st1sports.com'), 'Matt Stone <matt@st1sports.com>');
  });
});
