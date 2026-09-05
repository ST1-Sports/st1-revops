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

  it('catches Instantly-style tags that appear in the subject and again in the body', () => {
    assert.equal(junkReplyReason({
      subject: 'Re: quick hello xK92mP',
      body: 'Sounds good, talk soon.\n\nxK92mP',
      fromEmail: 'someone@gmail.com',
    }), 'warmup');
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
