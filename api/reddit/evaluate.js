/**
 * Reddit Engagement Module — thread fitness evaluator.
 *
 * Calls Claude with the evaluation prompt to produce a structured EvaluatorResult
 * for a candidate thread. The result is stored in RedditThread.evaluation and
 * drives the shouldReply decision.
 *
 * The prompt template lives at ./prompts/eval.md — edit it there, not here.
 *
 * TODO (Phase 3): activate the live Claude call and DB update. Current
 * implementation returns a clearly-labelled placeholder result so the rest
 * of the workflow can be exercised end-to-end before prompts are finalised.
 */

const fs      = require('fs');
const path    = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { PrismaClient } = require('@prisma/client');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

const EVAL_PROMPT_PATH = path.join(__dirname, 'prompts', 'eval.md');

// Loaded once per cold start
let _evalPrompt;
function getEvalPrompt() {
  if (!_evalPrompt) _evalPrompt = fs.readFileSync(EVAL_PROMPT_PATH, 'utf8');
  return _evalPrompt;
}

/**
 * Evaluate a single thread for brand fit.
 *
 * Looks up the thread by its DB id, calls Claude, validates the response shape,
 * and updates the DB record to EVALUATED status.
 *
 * @param {string} threadDbId  - RedditThread.id (cuid)
 * @param {boolean} [dryRun]   - If true, skip DB writes (useful for testing)
 * @returns {Promise<import('./types').EvaluatorResult>}
 */
async function evaluateThread(threadDbId, dryRun = false) {
  const db = getPrisma();

  const thread = await db.redditThread.findUnique({ where: { id: threadDbId } });
  if (!thread) throw new Error(`Thread not found: ${threadDbId}`);

  const prompt = getEvalPrompt()
    .replace('{{SUBREDDIT}}',    thread.subreddit)
    .replace('{{TITLE}}',        thread.title)
    .replace('{{BODY}}',         thread.body || '(no body text)')
    .replace('{{SCORE}}',        String(thread.score))
    .replace('{{COMMENT_COUNT}}',String(thread.commentCount));

  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_KEY });

  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 512,
    messages:   [{ role: 'user', content: prompt }],
  });

  const rawText = message.content?.[0]?.text || '';
  const result  = parseEvalResponse(rawText, threadDbId);

  if (!dryRun) {
    await db.redditThread.update({
      where: { id: threadDbId },
      data:  { evaluation: result, status: 'EVALUATED' },
    });
  }

  return result;
}

/**
 * Parse and validate the raw Claude response into an EvaluatorResult.
 * Extracts the JSON block (Claude may wrap it in markdown fences).
 *
 * @param {string} rawText
 * @param {string} threadDbId
 * @returns {import('./types').EvaluatorResult}
 */
function parseEvalResponse(rawText, threadDbId) {
  // Strip markdown code fences if present
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) || rawText.match(/(\{[\s\S]*\})/);
  const jsonStr   = jsonMatch ? jsonMatch[1] : rawText;

  let parsed;
  try {
    parsed = JSON.parse(jsonStr.trim());
  } catch {
    throw new Error(`[reddit/evaluate] Claude returned non-JSON for ${threadDbId}: ${rawText.slice(0, 200)}`);
  }

  // Validate required fields; supply safe defaults for optional ones
  return {
    fitScore:    typeof parsed.fitScore    === 'number' ? parsed.fitScore    : 0,
    intent:      typeof parsed.intent      === 'string' ? parsed.intent      : 'other',
    topics:      Array.isArray(parsed.topics)           ? parsed.topics      : [],
    reasoning:   typeof parsed.reasoning   === 'string' ? parsed.reasoning   : '',
    shouldReply: typeof parsed.shouldReply === 'boolean'? parsed.shouldReply : parsed.fitScore >= 6,
    redFlags:    Array.isArray(parsed.redFlags)         ? parsed.redFlags    : [],
  };
}

module.exports = { evaluateThread, parseEvalResponse };
