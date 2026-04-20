/**
 * Reddit Engagement Module — content guardrail service.
 *
 * Runs the guardrail.md prompt against a specific reply before it is shown
 * for review or posted. Separate from db-guardrails.js (mute/dedupe/rate-limit
 * DB checks) — this service handles AI-based content quality review.
 *
 * Every check result is persisted to RedditGuardrailLog for analytics regardless
 * of outcome (pass or block), so approval rates and risk score trends are queryable.
 *
 * The recent_replies_last_14_days context is built from posted RedditReply records
 * so Claude can detect repetition risk across recent account activity.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { PrismaClient } = require('@prisma/client');
const { load } = require('../prompt-loader');
const { validateGuardrailResult, parseJson } = require('../validators');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Run the content guardrail on a specific reply.
 *
 * @param {string} replyDbId
 * @param {Object} [opts]
 * @param {string} [opts.subredditRules='']
 * @param {string} [opts.topComments='']
 * @param {boolean}[opts.dryRun=false]
 * @param {string} [opts.calledFrom='check_action']  - For analytics ("check_action" | "post_gate")
 * @returns {Promise<import('../types').GuardrailResult>}
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
    subreddit:                   reply.thread.subreddit,
    subreddit_rules:             subredditRules || 'No specific rules provided.',
    title:                       reply.thread.title,
    body:                        reply.thread.body || '(no body text)',
    top_comments:                topComments || '(no comments fetched)',
    reply:                       reply.content,
    recent_replies_last_14_days: recentRepliesText,
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

  const message = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL_FOR_REDDIT_GUARDRAIL || 'claude-sonnet-4-6',
    max_tokens: 400,
    system,
    messages:   [{ role: 'user', content: user }],
  });

  const raw = message.content?.[0]?.text || '';
  const result = parseAndValidate(raw, replyDbId);

  saveGuardrailLog(db, {
    replyId:           replyDbId,
    threadId:          reply.threadId,
    subreddit:         reply.thread.subreddit,
    approvedForReview: result.approved_for_review,
    approvedForPost:   result.approved_for_post,
    finalRiskScore:    result.final_risk_score,
    blockReason:       result.block_reason    || null,
    editSuggestion:    result.edit_suggestion || null,
    calledFrom:        opts.calledFrom || 'check_action',
    dryRun,
  });

  return result;
}

/**
 * Build the recent_replies_last_14_days context string from DB.
 *
 * @param {import('@prisma/client').PrismaClient} db
 * @returns {Promise<string>}
 */
async function buildRecentRepliesContext(db) {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const recent = await db.redditReply.findMany({
    where:   { postedAt: { gte: since }, redditCommentId: { not: null } },
    include: { thread: { select: { subreddit: true, title: true } } },
    orderBy: { postedAt: 'desc' },
    take:    10,
  });

  if (recent.length === 0) return 'No replies posted in the last 14 days.';

  return recent.map((r, i) => {
    const date = r.postedAt ? r.postedAt.toISOString().slice(0, 10) : 'unknown';
    return `[${i + 1}] r/${r.thread.subreddit} — "${r.thread.title}" (${date})\n${r.content}`;
  }).join('\n\n');
}

function parseAndValidate(raw, replyDbId) {
  const parsed = parseJson(raw, `content-guardrail:${replyDbId}`);
  const { valid, errors } = validateGuardrailResult(parsed);

  if (!valid) {
    throw new Error(
      `[reddit/content-guardrail] Invalid guardrail output for ${replyDbId}:\n` +
      errors.map(e => `  • ${e}`).join('\n') +
      `\nRaw (first 400 chars): ${raw.slice(0, 400)}`
    );
  }

  return parsed;
}

async function saveGuardrailLog(db, data) {
  try {
    await db.redditGuardrailLog.create({ data });
  } catch (err) {
    console.error('[reddit/content-guardrail] saveGuardrailLog failed (non-fatal):', err.message);
  }
}

module.exports = { checkContent, buildRecentRepliesContext };
