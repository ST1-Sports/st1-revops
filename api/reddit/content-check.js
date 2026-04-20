/**
 * Reddit Engagement Module — content guardrail service.
 *
 * Runs the guardrail.md prompt against a specific reply before it is shown
 * for review or posted. This is separate from guardrails.js (which handles
 * DB-level mute/dedupe/rate-limit checks) and focuses exclusively on the
 * content quality review via Claude.
 *
 * The `recent_replies_last_14_days` context is built by querying the last
 * 14 days of posted RedditReply records so the model can detect repetition
 * risk across recent account activity.
 *
 * Prompt variables supplied to guardrail.md:
 *   subreddit                — subreddit name without r/
 *   subreddit_rules          — rules text passed in by caller (empty if unavailable)
 *   title                    — thread title
 *   body                     — thread body
 *   top_comments             — top comment summaries (empty if not fetched)
 *   reply                    — the proposed reply text to review
 *   recent_replies_last_14_days — formatted snippet of recent posted replies
 */

const Anthropic = require('@anthropic-ai/sdk');
const { PrismaClient } = require('@prisma/client');
const { load } = require('./prompt-loader');
const { validateGuardrailResult, parseJson } = require('./validators');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Run the content guardrail on a specific reply.
 *
 * @param {string} replyDbId      - RedditReply.id (cuid)
 * @param {Object} [opts]
 * @param {string} [opts.subredditRules='']
 * @param {string} [opts.topComments='']
 * @param {boolean}[opts.dryRun=false]  - Skip DB writes; still calls Claude
 * @returns {Promise<import('./types').GuardrailResult>}
 */
async function checkContent(replyDbId, opts = {}) {
  const { subredditRules = '', topComments = '', dryRun = false } = opts;

  const db = getPrisma();

  const reply = await db.redditReply.findUnique({
    where:   { id: replyDbId },
    include: { thread: true },
  });
  if (!reply) throw new Error(`Reply not found: ${replyDbId}`);

  const recentRepliesText = await buildRecentRepliesContext(db);

  const { system, user } = load('guardrail', {
    subreddit:                reply.thread.subreddit,
    subreddit_rules:          subredditRules || 'No specific rules provided.',
    title:                    reply.thread.title,
    body:                     reply.thread.body || '(no body text)',
    top_comments:             topComments || '(no comments fetched)',
    reply:                    reply.content,
    recent_replies_last_14_days: recentRepliesText,
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 400,
    system,
    messages:   [{ role: 'user', content: user }],
  });

  const raw = message.content?.[0]?.text || '';
  const result = parseAndValidate(raw, replyDbId);

  return result;
}

/**
 * Build the recent_replies_last_14_days context string by querying DB for
 * replies posted in the last 14 days. Returns a formatted list, or a
 * no-history placeholder if none exist.
 *
 * @param {import('@prisma/client').PrismaClient} db
 * @returns {Promise<string>}
 */
async function buildRecentRepliesContext(db) {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const recent = await db.redditReply.findMany({
    where: {
      postedAt:   { gte: since },
      redditCommentId: { not: null },
    },
    include: { thread: { select: { subreddit: true, title: true } } },
    orderBy: { postedAt: 'desc' },
    take: 10,
  });

  if (recent.length === 0) {
    return 'No replies posted in the last 14 days.';
  }

  return recent.map((r, i) => {
    const date = r.postedAt ? r.postedAt.toISOString().slice(0, 10) : 'unknown';
    return `[${i + 1}] r/${r.thread.subreddit} — "${r.thread.title}" (${date})\n${r.content}`;
  }).join('\n\n');
}

/**
 * Parse and validate raw Claude output into a GuardrailResult.
 * Throws with a descriptive message if the JSON is invalid or schema fails.
 *
 * @param {string} raw
 * @param {string} replyDbId
 * @returns {import('./types').GuardrailResult}
 */
function parseAndValidate(raw, replyDbId) {
  const parsed = parseJson(raw, `content-check:${replyDbId}`);
  const { valid, errors } = validateGuardrailResult(parsed);

  if (!valid) {
    throw new Error(
      `[reddit/content-check] Invalid guardrail output for ${replyDbId}:\n` +
      errors.map(e => `  • ${e}`).join('\n') +
      `\nRaw (first 400 chars): ${raw.slice(0, 400)}`
    );
  }

  return parsed;
}

module.exports = { checkContent, buildRecentRepliesContext };
