/**
 * Reddit Engagement Module — reply generator.
 *
 * Calls Claude with the reply.md prompt (SYSTEM/USER format) and returns a
 * GeneratedReplySet. If Claude returns SKIP (no credible value-add), returns
 * { skip: true } and writes nothing to the DB.
 *
 * DB mapping:
 *   primary_reply → RedditReply { variant: 1, content: primary_reply }
 *   safer_reply   → RedditReply { variant: 2, content: safer_reply }
 *
 * why_it_works and risk_notes are returned in the API response for the reviewer
 * UI but are not persisted (no DB column). They are ephemeral per-generation.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { PrismaClient } = require('@prisma/client');
const { load } = require('../prompt-loader');
const { validateGeneratedReplySet, parseJson, isSkipResponse } = require('../validators');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Generate two reply variants for an evaluated thread.
 *
 * Returns { skip: true } if Claude determines there is no value-add.
 * Returns a GeneratedReplySet with primary_reply / safer_reply otherwise.
 *
 * @param {string}  threadDbId
 * @param {Object}  [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {boolean} [opts.allowVendorMention=false]
 * @param {boolean} [opts.allowLinks=false]
 * @param {string}  [opts.subredditRules='']
 * @param {string}  [opts.topComments='']
 * @returns {Promise<import('../types').GeneratedReplySet>}
 */
async function generateReplies(threadDbId, opts = {}) {
  const {
    dryRun             = false,
    allowVendorMention = false,
    allowLinks         = false,
    subredditRules     = '',
    topComments        = '',
  } = opts;

  const db = getPrisma();
  const thread = await db.redditThread.findUnique({ where: { id: threadDbId } });
  if (!thread) throw new Error(`Thread not found: ${threadDbId}`);

  const ev = thread.evaluation;
  if (!ev) throw new Error(`Thread ${threadDbId} has no evaluation — run evaluateThread first`);

  const { system, user } = load('reply', {
    subreddit:            thread.subreddit,
    subreddit_rules:      subredditRules || 'No specific rules provided.',
    title:                thread.title,
    body:                 thread.body || '(no body text)',
    top_comments:         topComments  || '(no comments fetched)',
    decision:             ev.decision       ?? '',
    fit_score:            String(ev.fit_score   ?? ''),
    promo_risk:           String(ev.promo_risk  ?? ''),
    intent_type:          ev.intent_type    ?? 'general_discussion',
    audience_type:        ev.audience_type  ?? 'unknown',
    value_angle:          ev.value_angle    ?? '',
    allow_vendor_mention: String(allowVendorMention),
    allow_links:          String(allowLinks),
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 700,
    system,
    messages:   [{ role: 'user', content: user }],
  });

  const raw = message.content?.[0]?.text || '';

  if (isSkipResponse(raw)) {
    return { skip: true };
  }

  const replySet = parseAndValidate(raw, threadDbId);

  if (!dryRun) {
    await db.redditReply.create({
      data: { threadId: threadDbId, variant: 1, content: replySet.primary_reply },
    });
    await db.redditReply.create({
      data: { threadId: threadDbId, variant: 2, content: replySet.safer_reply },
    });
  }

  return replySet;
}

function parseAndValidate(raw, threadDbId) {
  const parsed = parseJson(raw, `reply-generator:${threadDbId}`);
  const { valid, errors } = validateGeneratedReplySet(parsed);

  if (!valid) {
    throw new Error(
      `[reddit/reply-generator] Invalid reply output for ${threadDbId}:\n` +
      errors.map(e => `  • ${e}`).join('\n') +
      `\nRaw (first 400 chars): ${raw.slice(0, 400)}`
    );
  }

  return parsed;
}

module.exports = { generateReplies, parseAndValidate };
