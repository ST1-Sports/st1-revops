/**
 * Fixture: GOOD FIT
 *
 * A youth hockey team manager is actively looking for a jersey vendor with a
 * specific timeline, budget, and product scope. Intent is unambiguous. No
 * vendor is named. Thread is recent and constructive. Classic buying_now signal.
 *
 * Expected evaluator output:
 *   decision:      REPLY
 *   fit_score:     8–10
 *   promo_risk:    2–4  (open question, no vendor mentioned, safe to engage)
 *   confidence:    8–10
 *   intent_type:   buying_now
 *   audience_type: coach
 */

/** @type {import('../types').CandidateThread} */
const thread = {
  redditId:     't3_gf0001',
  subreddit:    'hockeyplayers',
  title:        'Recommendations for jersey vendor — U14 travel team, 22 players, need in 6 weeks',
  body: `Hi all. I manage a U14 travel hockey team and we need to order jerseys, \
socks, and practice shirts before our season starts. Budget is around $1,800 total \
(parents are cost-conscious this year). We had a nightmare last season — vendor took \
10 weeks and three jerseys came in the wrong colour. Looking for someone more reliable \
with faster turnaround. Any vendors you've used and actually been happy with? Sublimation \
preferred if possible, open to other options. Thanks.`,
  url:          'https://reddit.com/r/hockeyplayers/comments/gf0001/',
  author:       'coach_mikeh',
  score:        63,
  commentCount: 18,
  ingestedAt:   '2025-04-20T09:00:00Z',
};

/** Simulated subreddit rules string passed as {{subreddit_rules}}. */
const subredditRules = 'Be respectful. No spam or self-promotion. Vendor recommendations are allowed in advice threads.';

/** Simulated top comments summary passed as {{top_comments}}. */
const topComments = `
Comment by u/icemom_jen: "We used a local shop last year, decent but slow."
Comment by u/hockeycoach99: "Sublimation is worth it for durability, agree."
Comment by u/pucklover42: "Good luck finding anything decent under $80/jersey these days."
`.trim();

/**
 * Minimum expectations for the evaluator output.
 * Any field listed here must match or fall within the stated range.
 * Fields not listed are not asserted.
 */
const expected = {
  decision:      'REPLY',
  intent_type:   'buying_now',
  audience_type: 'coach',
  fit_score_min: 7,        // must be ≥ this
  promo_risk_max: 5,       // must be ≤ this
  confidence_min: 7,
  should_have_value_angle: true,
  do_not_reply_reason_empty: true,
};

module.exports = { thread, subredditRules, topComments, expected };
