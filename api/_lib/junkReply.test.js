import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { junkReplyReason, isJunkInboundReply, junkReplyFromStored, isBradFollowUpReply } from './junkReply.js';

describe('junkReplyReason — out of office', () => {
  it('catches a typical OOO subject', () => {
    assert.equal(junkReplyReason({ subject: 'Automatic reply: Re: Fall baseball quote' }), 'ooo');
    assert.equal(junkReplyReason({ subject: 'Out of Office' }), 'ooo');
    assert.equal(junkReplyReason({ subject: 'OOO — back Monday' }), 'ooo');
  });

  it('catches OOO body copy even with a normal subject', () => {
    assert.equal(junkReplyReason({
      subject: 'Re: ST1 gear',
      body: 'I am currently out of the office and will return Monday. For urgent needs contact the AD.',
    }), 'ooo');
  });

  it('treats Auto-Submitted headers as OOO', () => {
    assert.equal(junkReplyReason({
      subject: 'Re: quote',
      body: 'Thanks',
      headers: { 'Auto-Submitted': 'auto-replied' },
    }), 'ooo');
  });
});

describe('junkReplyReason — warmup tools', () => {
  it('catches Instantly / Mailwarm wording', () => {
    assert.equal(junkReplyReason({
      subject: 'Re: quick hello',
      body: 'Sounds good — looking forward to it.\n\nThis email is part of an automated warmup.',
    }), 'warmup');
    assert.equal(junkReplyReason({
      subject: 'Checking in [warmup filter tag]',
      body: 'Got your note.',
    }), 'warmup');
  });

  it('catches known warmup sending hosts', () => {
    assert.equal(junkReplyReason({
      subject: 'Re: intro',
      body: 'Thanks!',
      fromEmail: 'node12@mailwarm.com',
    }), 'warmup');
  });

  it('does not use subject tags alone: real replies repeat quote and invoice numbers', () => {
    for (const [subject, body] of [
      ['Re: quick hello xK92mP', 'Sounds good, talk soon.\n\nxK92mP'],
      ['Re: Quote Q-10234', 'Please resend Q-10234 with the new sizes.'],
      ['Re: Invoice INV-000123', 'Paid INV-000123 today, thanks.'],
      ['Re: Estimate EST-0042', 'Approved EST-0042, go ahead.'],
      ['Re: Spring order 2027A', 'Can we add 10 more to 2027A?'],
    ])
      assert.equal(junkReplyReason({ subject, body, fromEmail: 'coach@school.org' }), null, subject);
  });

  it('does not treat sports "warm up" as a warmup tool', () => {
    assert.equal(junkReplyReason({
      subject: 'Re: basketball order',
      body: 'We need to warm up before the game. Can you quote shooting shirts?',
      fromEmail: 'coach@hudson.k12.ia.us',
    }), null);
  });
});

describe('junkReplyReason — keep real interest', () => {
  it('lets a coach who wants pricing through', () => {
    assert.equal(isJunkInboundReply({
      subject: 'Re: ST1 football',
      body: 'Yes we are interested. Can you send pricing for 40 helmets?',
      fromEmail: 'ad@lincoln.k12.ia.us',
    }), false);
  });

  it('does not treat a quote number in the subject as an Instantly warmup tag', () => {
    assert.equal(junkReplyReason({
      subject: 'Re: ST1-20260831-ABCD',
      body: 'Please send the ST1-20260831-ABCD quote again.',
      fromEmail: 'ad@lincoln.k12.ia.us',
    }), null);
  });
});

describe('junkReplyFromStored', () => {
  it('reads the snippet Brad already saved on the reply row', () => {
    assert.equal(junkReplyFromStored({
      input: { subject: 'Automatic reply: Re: quote', snippet: 'I am out of the office', fromEmail: 'ad@x.edu' },
    }), 'ooo');
  });
});

describe('isBradFollowUpReply', () => {
  it('keeps a real pending coach reply and drops OOO / warmup', () => {
    assert.equal(isBradFollowUpReply({
      outcome: 'pending',
      input: { subject: 'Re: helmets', snippet: 'Can you send pricing?', fromEmail: 'ad@lincoln.k12.ia.us' },
    }), true);
    assert.equal(isBradFollowUpReply({
      outcome: 'pending',
      input: { subject: 'Automatic reply: Re: helmets', snippet: 'I am out of the office', fromEmail: 'ad@lincoln.k12.ia.us' },
    }), false);
    assert.equal(isBradFollowUpReply({
      outcome: 'handled',
      input: { subject: 'Re: helmets', snippet: 'Can you send pricing?', fromEmail: 'ad@lincoln.k12.ia.us' },
    }), false);
  });
});

describe('junkReplyReason — real buyer replies are never hidden', () => {
  it('ignores the everyday word "instantly" and tool names without warmup wording', () => {
    assert.equal(junkReplyReason({
      subject: 'Re: track spikes',
      body: 'Yes! I can instantly approve this, send pricing.',
    }), null);
    assert.equal(junkReplyReason({ subject: 'Re: hello', body: 'We use Smartlead for our newsletter, but yes, send a quote.' }), null);
  });
  it('lets a person mention being away when there is no autoresponder cue', () => {
    assert.equal(junkReplyReason({
      subject: 'Re: uniforms',
      body: 'I will be away next week but yes, interested — send pricing.',
    }), null);
    assert.equal(junkReplyReason({
      subject: 'Re: uniforms',
      body: "I'm out of the office today, but please send the quote over.",
    }), null);
  });
  it('still catches an out-of-office body with an autoresponder cue', () => {
    assert.equal(junkReplyReason({
      subject: 'Re: uniforms',
      body: 'I will be away until June 3 with limited replies. I will respond to your email upon my return.',
    }), 'ooo');
  });
});
