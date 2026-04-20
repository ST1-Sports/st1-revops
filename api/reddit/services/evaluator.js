/**
 * Reddit Engagement Module — thread fitness evaluator.
 *
 * Calls Claude with the eval.md prompt (SYSTEM/USER format) and returns a
 * structured EvaluatorResult. The result is stored in RedditThread.evaluation
 * and drives the reply generation and Slack review workflow.
 *
 * Prompt variables required by eval.md:
 *   subreddit_rules — subreddit-specific rules (empty string if not available)
 *   title           — thread title
 *   body            — thread body (self-post text)
 *   top_comments    — concatenated top comment summaries (empty if not fetched)
 *   subreddit       — subreddit name without r/
 *   author          — OP username
 */

const Anthropic = require('@anthropic-ai/sdk');
const { PrismaClient } = require('@prisma/client');
const { load } = require('../prompt-loader');
const { validateEvaluatorResult, parseJson } = require('../validators');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Evaluate a single thread for brand fit.
 *
 * Fetches the thread from the DB, calls Claude, validates the response,
 * and updates the thread record to EVALUATED status.
 *
 * @param {string}  threadDbId
 * @param {Object}  [opts]
 * @param {string}  [opts.subredditRules='']
 * @param {string}  [opts.topComments='']
 * @param {boolean} [opts.dryRun=false]
 * @returns {Promise<import('../types').EvaluatorResult>}
 */
async function evaluateThread(threadDbId, opts = {}) {
  const { subredditRules = '', topComments = '', dryRun = false } = opts;
  const db = getPrisma();

  const thread = await db.redditThread.findUnique({ where: { id: threadDbId } });
  if (!thread) throw new Error(`Thread not found: ${threadDbId}`);

  const { system, user } = load('eval', {
    subreddit_rules: subredditRules || 'No specific rules provided.',
    title:           thread.title,
    body:            thread.body || '(no body text)',
    top_comments:    topComments || '(no comments fetched)',
    subreddit:       thread.subreddit,
    author:          thread.author,
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 600,
    system,
    messages:   [{ role: 'user', content: user }],
  });

  const raw = message.content?.[0]?.text || '';
  const result = parseAndValidate(raw, threadDbId);

  if (!dryRun) {
    await db.redditThread.update({
      where: { id: threadDbId },
      data:  { evaluation: result, status: 'EVALUATED' },
    });
  }

  return result;
}

function parseAndValidate(raw, threadDbId) {
  const parsed = parseJson(raw, `eval:${threadDbId}`);
  const { valid, errors } = validateEvaluatorResult(parsed);

  if (!valid) {
    throw new Error(
      `[reddit/evaluator] Invalid evaluator output for ${threadDbId}:\n` +
      errors.map(e => `  • ${e}`).join('\n') +
      `\nRaw (first 400 chars): ${raw.slice(0, 400)}`
    );
  }

  return parsed;
}

module.exports = { evaluateThread, parseAndValidate };
