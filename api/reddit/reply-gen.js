/**
 * Reddit Engagement Module — reply generator.
 *
 * Calls Claude with the reply.md prompt (SYSTEM/USER format) and returns a
 * GeneratedReplySet with exactly 2 variants. Both variants are persisted as
 * RedditReply rows. The thread status advances to NOTIFIED after the Slack
 * notification is sent (handled by slack-review.js, not here).
 *
 * Prompt variables required by reply.md:
 *   subreddit_rules — subreddit rules text (empty string if not available)
 *   title           — thread title
 *   body            — thread body
 *   top_comments    — top comment summaries (empty if not fetched)
 *   subreddit       — subreddit name
 *   intent_type     — from EvaluatorResult
 *   audience_type   — from EvaluatorResult
 *   value_angle     — from EvaluatorResult
 *   fit_score       — from EvaluatorResult
 *
 * Content guardrails applied post-generation (before DB write):
 *   - URLs stripped
 *   - Hard cap at MAX_REPLY_CHARS characters
 */

const Anthropic = require('@anthropic-ai/sdk');
const { PrismaClient } = require('@prisma/client');
const { load } = require('./prompt-loader');
const { validateGeneratedReplySet, parseJson } = require('./validators');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

const MAX_REPLY_CHARS = 300;

/**
 * Generate 2 reply variants for an evaluated thread and persist them.
 *
 * @param {string}  threadDbId
 * @param {Object}  [opts]
 * @param {string}  [opts.subredditRules='']
 * @param {string}  [opts.topComments='']
 * @param {boolean} [opts.dryRun=false]
 * @returns {Promise<import('./types').GeneratedReplySet>}
 */
async function generateReplies(threadDbId, opts = {}) {
  const { subredditRules = '', topComments = '', dryRun = false } = opts;
  const db = getPrisma();

  const thread = await db.redditThread.findUnique({ where: { id: threadDbId } });
  if (!thread) throw new Error(`Thread not found: ${threadDbId}`);

  const ev = thread.evaluation;
  if (!ev) throw new Error(`Thread ${threadDbId} has no evaluation — run evaluateThread first`);

  const { system, user } = load('reply', {
    subreddit_rules: subredditRules || 'No specific rules provided.',
    title:           thread.title,
    body:            thread.body || '(no body text)',
    top_comments:    topComments || '(no comments fetched)',
    subreddit:       thread.subreddit,
    intent_type:     ev.intent_type   ?? 'general_discussion',
    audience_type:   ev.audience_type ?? 'unknown',
    value_angle:     ev.value_angle   ?? '',
    fit_score:       String(ev.fit_score ?? ''),
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 800,
    system,
    messages:   [{ role: 'user', content: user }],
  });

  const raw = message.content?.[0]?.text || '';
  const replySet = parseAndValidate(raw, threadDbId);

  // Apply content guardrails after validation
  for (const v of replySet.variants) {
    v.body = applyContentGuardrails(v.body);
  }

  if (!dryRun) {
    for (const variant of replySet.variants) {
      await db.redditReply.create({
        data: {
          threadId: threadDbId,
          variant:  variant.id,       // maps GeneratedReplySet.id → DB column "variant"
          content:  variant.body,     // maps GeneratedReplySet.body → DB column "content"
        },
      });
    }
  }

  return replySet;
}

/**
 * Parse and validate raw Claude output into a GeneratedReplySet.
 *
 * @param {string} raw
 * @param {string} threadDbId
 * @returns {import('./types').GeneratedReplySet}
 */
function parseAndValidate(raw, threadDbId) {
  const parsed = parseJson(raw, `reply-gen:${threadDbId}`);
  const { valid, errors } = validateGeneratedReplySet(parsed);

  if (!valid) {
    throw new Error(
      `[reddit/reply-gen] Invalid reply output for ${threadDbId}:\n` +
      errors.map(e => `  • ${e}`).join('\n') +
      `\nRaw (first 400 chars): ${raw.slice(0, 400)}`
    );
  }

  return parsed;
}

/**
 * Strip disallowed content from a reply body.
 * - Remove URLs (http/https)
 * - Hard-cap at MAX_REPLY_CHARS
 *
 * The validator already checks these constraints; this is a defensive fallback
 * in case the model ignores the rules despite the prompt.
 *
 * @param   {string} text
 * @returns {string}
 */
function applyContentGuardrails(text) {
  let clean = text.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim();
  if (clean.length > MAX_REPLY_CHARS) {
    clean = clean.slice(0, MAX_REPLY_CHARS - 1).trimEnd() + '…';
  }
  return clean;
}

module.exports = { generateReplies, parseAndValidate, applyContentGuardrails };
