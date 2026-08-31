import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asciiHeaderText, quoteEmailSigner, buildQuoteEmailDraft, sanitizeOutgoingQuoteEmail } from './quoteEmail.js';

describe('asciiHeaderText', () => {
  it('turns an em dash into a plain hyphen so the subject cannot mojibake', () => {
    assert.equal(
      asciiHeaderText('Your quote from ST1 Sports — ST1-20260831-B03B'),
      'Your quote from ST1 Sports - ST1-20260831-B03B'
    );
    assert.equal(asciiHeaderText('Your quote from ST1 Sports Ã¢Â€Â” ST1-1').includes('Ã'), false);
  });
});

describe('quoteEmailSigner', () => {
  const company = { ownerName: 'Matt Stone', email: 'matt@st1sports.com', phone: '719-256-0275', name: 'ST1 Sports' };

  it('does not sign as Admin when the owner bypass is logged in', () => {
    const s = quoteEmailSigner({ name: 'Admin', email: '' }, company);
    assert.equal(s.name, 'Matt Stone');
    assert.equal(s.email, 'matt@st1sports.com');
  });

  it('keeps a real rep name', () => {
    const s = quoteEmailSigner({ name: 'Josh Stone', email: 'josh@st1sports.com', phone: '555-0100' }, company);
    assert.equal(s.name, 'Josh Stone');
    assert.equal(s.email, 'josh@st1sports.com');
  });
});

describe('buildQuoteEmailDraft', () => {
  it('builds a first-name note signed by Matt, not Admin', () => {
    const d = buildQuoteEmailDraft({
      quoteNumber: 'ST1-20260831-B03B',
      contactName: 'Kevin Qurzer',
      school: 'Hudson High School',
      cu: { name: 'Admin' },
      company: { ownerName: 'Matt Stone', email: 'matt@st1sports.com', phone: '719-256-0275', name: 'ST1 Sports' },
    });
    assert.equal(d.subject, 'Your quote from ST1 Sports - ST1-20260831-B03B');
    assert.match(d.subject, /^[\x20-\x7E]+$/);
    assert.match(d.body, /^Hi Kevin,/);
    assert.match(d.body, /Hudson High School/);
    assert.match(d.body, /Matt Stone/);
    assert.doesNotMatch(d.body, /Admin/);
    assert.match(d.body, /matt@st1sports.com/);
  });
});

describe('sanitizeOutgoingQuoteEmail', () => {
  it('rewrites a leftover Thanks, Admin draft before send', () => {
    const out = sanitizeOutgoingQuoteEmail(
      { subject: 'Your quote from ST1 Sports — ST1-9', body: 'Hi Kevin,\n\nAttached.\n\nThanks,\nAdmin' },
      { name: 'Admin' },
      { ownerName: 'Matt Stone', email: 'matt@st1sports.com', phone: '719-256-0275', name: 'ST1 Sports' }
    );
    assert.equal(out.subject.includes('—'), false);
    assert.equal(out.subject.includes('Ã'), false);
    assert.match(out.body, /Matt Stone/);
    assert.doesNotMatch(out.body, /Admin/);
  });
});
