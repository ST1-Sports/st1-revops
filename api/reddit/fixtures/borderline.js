/**
 * Fixture: BORDERLINE
 *
 * A beer-league adult player asks whether people customise their helmets.
 * The topic is adjacent (custom sports gear) but intent is general discussion,
 * not a buying decision. No clear value-add that isn't generic. A vendor reply
 * risks feeling forced. Correct answer is MONITOR, not REPLY.
 *
 * Expected evaluator output:
 *   decision:      MONITOR  (could plausibly be SKIP — REPLY would be wrong)
 *   fit_score:     4–6
 *   promo_risk:    5–8  (casual discussion thread; vendor reply would stand out)
 *   confidence:    5–8
 *   intent_type:   general_discussion
 *   audience_type: athlete
 */

/** @type {import('../types').CandidateThread} */
const thread = {
  redditId:     't3_bl0001',
  subreddit:    'baseball',
  title:        'Anyone bother with custom batting helmets or is that overkill for beer league?',
  body: `We do custom jerseys for our team (looks sick) but always bought stock helmets. \
Wondering if anyone's actually done custom helmets and whether it's worth the cost. \
Not a serious team or anything, just curious what people think.`,
  url:          'https://reddit.com/r/baseball/comments/bl0001/',
  author:       'bleaguer_dan',
  score:        14,
  commentCount: 9,
  ingestedAt:   '2025-04-20T09:00:00Z',
};

const subredditRules = 'No spam. Keep it baseball-related. Gear discussion is fine.';

const topComments = `
Comment by u/slowpitch_sam: "We looked into it once, way too expensive for rec league."
Comment by u/baseballmom_tx: "Overkill IMO, helmets are helmets."
Comment by u/yardsale_mike: "Did custom lids for our adult league once, took forever and half the team hated the design."
`.trim();

/**
 * Acceptable outcome range.
 * decision may be MONITOR or SKIP — REPLY would indicate the model over-fit.
 */
const expected = {
  decision_one_of:  ['MONITOR', 'SKIP'],
  intent_type:      'general_discussion',
  audience_type:    'athlete',
  fit_score_max:    6,          // must be ≤ this
  promo_risk_min:   4,          // must be ≥ this
  do_not_reply_reason_empty: false,
};

module.exports = { thread, subredditRules, topComments, expected };
