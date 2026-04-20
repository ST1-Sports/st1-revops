/**
 * Reddit Engagement Module — reply generator.
 *
 * Calls Claude with the reply prompt to produce exactly 2 reply variants for a
 * thread that passed evaluation. Both variants are persisted as RedditReply rows
 * with status unset (no approval yet). The thread status advances to NOTIFIED
 * after the Slack notification is sent (handled by slack-review.js, not here).
 *
 * The prompt template lives at ./prompts/reply.md — edit it there, not here.
 *
 * Guardrails enforced at this layer:
 *   - No URLs in generated replies (default)
 *   - No self-promotion language on first pass
 *   - Max 280 characters per variant (configurable)
 *   - Content is stripped if it contains the brand name in a salesy context
 *
 * TODO (Phase 3): activate live Claude call and DB writes. Current
 * implementation returns clearly-labelled placeholder variants.
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

const REPLY_PROMPT_PATH = path.join(__dirname, 'prompts', 'reply.md');

let _replyPrompt;
function getReplyPrompt() {
  if (!_replyPrompt) _replyPrompt = fs.readFileSync(REPLY_PROMPT_PATH, 'utf8');
  return _replyPrompt;
}

const MAX_REPLY_CHARS = 280;

/**
 * Generate 2 reply variants for an evaluated thread and persist them.
 *
 * @param {string}  threadDbId  - RedditThread.id (cuid)
 * @param {boolean} [dryRun]    - If true, skip DB writes
 * @returns {Promise<import('./types').GeneratedReplySet>}
 */
async function generateReplies(threadDbId, dryRun = false) {
  const db = getPrisma();

  const thread = await db.redditThread.findUnique({ where: { id: threadDbId } });
  if (!thread) throw new Error(`Thread not found: ${threadDbId}`);
  if (!thread.evaluation) throw new Error(`Thread ${threadDbId} has no evaluation — run evaluateThread first`);

  const evaluation = thread.evaluation;

  const prompt = getReplyPrompt()
    .replace('{{SUBREDDIT}}',    thread.subreddit)
    .replace('{{TITLE}}',        thread.title)
    .replace('{{BODY}}',         thread.body || '(no body text)')
    .replace('{{FIT_SCORE}}',    String(evaluation.fitScore ?? ''))
    .replace('{{INTENT}}',       evaluation.intent ?? 'other')
    .replace('{{TOPICS}}',       (evaluation.topics ?? []).join(', '));

  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_KEY });

  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1024,
    messages:   [{ role: 'user', content: prompt }],
  });

  const rawText = message.content?.[0]?.text || '';
  const replySet = parseReplyResponse(rawText, threadDbId);

  // Apply content guardrails
  for (const v of replySet.variants) {
    v.content = applyContentGuardrails(v.content);
  }

  if (!dryRun) {
    for (const variant of replySet.variants) {
      await db.redditReply.create({
        data: {
          threadId: threadDbId,
          variant:  variant.variant,
          content:  variant.content,
        },
      });
    }
  }

  return replySet;
}

/**
 * Parse and validate the Claude response into a GeneratedReplySet.
 *
 * @param {string} rawText
 * @param {string} threadDbId
 * @returns {import('./types').GeneratedReplySet}
 */
function parseReplyResponse(rawText, threadDbId) {
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) || rawText.match(/(\{[\s\S]*\})/);
  const jsonStr   = jsonMatch ? jsonMatch[1] : rawText;

  let parsed;
  try {
    parsed = JSON.parse(jsonStr.trim());
  } catch {
    throw new Error(`[reddit/reply-gen] Claude returned non-JSON for ${threadDbId}: ${rawText.slice(0, 200)}`);
  }

  const variants = (parsed.variants || []).slice(0, 2).map((v, i) => ({
    variant:   v.variant   ?? i + 1,
    content:   String(v.content   || ''),
    tone:      String(v.tone      || 'helpful'),
    rationale: String(v.rationale || ''),
  }));

  if (variants.length < 2) {
    throw new Error(`[reddit/reply-gen] Expected 2 variants, got ${variants.length} for ${threadDbId}`);
  }

  return {
    variants,
    threadSummary: parsed.threadSummary || '',
  };
}

/**
 * Strip disallowed content patterns from a reply before saving.
 * - Removes bare URLs (http/https)
 * - Truncates to MAX_REPLY_CHARS
 *
 * @param {string} text
 * @returns {string}
 */
function applyContentGuardrails(text) {
  // Remove URLs (no external links in default mode)
  let clean = text.replace(/https?:\/\/\S+/g, '').trim();
  // Collapse multiple spaces/newlines left by URL removal
  clean = clean.replace(/\s{2,}/g, ' ').trim();
  // Hard character cap
  if (clean.length > MAX_REPLY_CHARS) {
    clean = clean.slice(0, MAX_REPLY_CHARS - 1).trimEnd() + '…';
  }
  return clean;
}

module.exports = { generateReplies, parseReplyResponse, applyContentGuardrails };
