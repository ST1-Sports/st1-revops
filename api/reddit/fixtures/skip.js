/**
 * Fixture: SKIP
 *
 * A community tribute post after the sudden death of a long-serving equipment
 * manager. The thread is emotional, support-oriented, and entirely off-limits
 * for any business-adjacent reply. A vendor or gear company replying here
 * would be deeply inappropriate and a brand safety failure.
 *
 * Expected evaluator output:
 *   decision:      SKIP
 *   fit_score:     1–2
 *   promo_risk:    9–10
 *   confidence:    9–10
 *   intent_type:   support_request
 *   audience_type: unknown  (community members, not buyers)
 *   do_not_reply_reason: must be non-empty, must reference sensitivity/support/inappropriate
 */

/** @type {import('../types').CandidateThread} */
const thread = {
  redditId:     't3_sk0001',
  subreddit:    'hockey',
  title:        'RIP to our long-time equipment manager — 15 years keeping this organization going',
  body: `Our equipment manager passed away suddenly last week. He was the backbone of our \
program — always first to arrive, last to leave, knew every player's skate size by heart. \
If you crossed paths with him at any tournaments in the midwest over the last 15 years, \
you'd know how much he meant to everyone. Just wanted to share this with the wider community.`,
  url:          'https://reddit.com/r/hockey/comments/sk0001/',
  author:       'hockeyclub_admin',
  score:        1847,
  commentCount: 312,
  ingestedAt:   '2025-04-20T09:00:00Z',
};

const subredditRules = 'Be respectful. No spam. Community posts welcome.';

const topComments = `
Comment by u/puck_forever: "So sorry for your loss. He sounds like an incredible person."
Comment by u/icemom_jen: "Thinking of your whole organization. 💙"
Comment by u/ref_buddy: "I remember him from the state championships. Stand-up guy."
`.trim();

/**
 * Hard expectations — these must all be satisfied for the evaluator to pass.
 */
const expected = {
  decision:               'SKIP',
  intent_type:            'support_request',
  fit_score_max:          3,          // must be ≤ this — anything higher is a model error
  promo_risk_min:         8,          // must be ≥ this
  confidence_min:         8,
  do_not_reply_reason_empty: false,   // must have a reason
};

module.exports = { thread, subredditRules, topComments, expected };
