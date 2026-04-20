/**
 * Reddit Engagement Module — Slack review notifier.
 *
 * Sends a structured Slack notification when a thread has reply variants ready
 * for human review. The message includes:
 *   - Thread title, subreddit, scores, and link
 *   - Evaluator decision + reasoning_summary
 *   - Both reply variants with tone labels
 *   - A direct link to the approval UI in the RevOps app
 *
 * Approval happens in the RevOps web UI (/reddit), not via Slack buttons.
 * The Slack message is informational only — no interactive components needed.
 *
 * Uses the existing Slack MCP pattern: routes through Anthropic SDK with
 * MCP server config (same as slackSend in src/lib/api.js).
 */

const { PrismaClient } = require('@prisma/client');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Build the Slack message for a thread review notification.
 *
 * @param {Object}   thread     - RedditThread DB record (with evaluation JSON)
 * @param {Object[]} replies    - RedditReply DB records, ordered by variant asc
 * @param {string}   appBaseUrl - RevOps deployment URL, e.g. "https://app.vercel.app"
 * @returns {string}            - Slack-formatted markdown
 */
function buildSlackMessage(thread, replies, appBaseUrl) {
  const ev  = thread.evaluation || {};

  // New schema field names
  const fitScore  = ev.fit_score         ?? '?';
  const promoRisk = ev.promo_risk        ?? '?';
  const decision  = ev.decision          ?? '?';
  const intent    = ev.intent_type       ?? 'unknown';
  const audience  = ev.audience_type     ?? 'unknown';
  const reasoning = ev.reasoning_summary ?? '';
  const angle     = ev.value_angle       ?? '';

  const approvalUrl = `${appBaseUrl}/reddit?thread=${thread.id}`;

  const variantLines = replies.map(r => {
    // DB stores content in "content" column; the tone is stored in notes via reply-gen
    return `*Variant ${r.variant}*\n> ${r.content}`;
  }).join('\n\n');

  return [
    `*Reddit thread ready for review — ${decision}*`,
    ``,
    `*Thread:* ${thread.title}`,
    `*Subreddit:* r/${thread.subreddit} · *Score:* ${thread.score} · *Comments:* ${thread.commentCount}`,
    `*Link:* ${thread.url}`,
    ``,
    `*Fit:* ${fitScore}/10 · *Promo risk:* ${promoRisk}/10 · *Intent:* ${intent} · *Audience:* ${audience}`,
    reasoning ? `*Reasoning:* ${reasoning}` : null,
    angle     ? `*Value angle:* ${angle}`   : null,
    ``,
    `*Reply variants:*`,
    variantLines,
    ``,
    `*Review and approve in RevOps:*`,
    approvalUrl,
  ].filter(l => l !== null).join('\n');
}

/**
 * Send a Slack notification for a thread awaiting review.
 * Updates thread status to NOTIFIED and stamps replies with slackNotifiedAt.
 *
 * @param {string}  threadDbId  - RedditThread.id
 * @param {string}  appBaseUrl  - Base URL of the deployment
 * @param {boolean} [dryRun]    - If true, return message without sending
 * @returns {Promise<{ sent: boolean, message: string, error?: string }>}
 */
async function notifySlack(threadDbId, appBaseUrl, dryRun = false) {
  const channelId = process.env.REDDIT_SLACK_CHANNEL;
  if (!channelId) {
    return { sent: false, message: '', error: 'REDDIT_SLACK_CHANNEL not configured' };
  }

  const db = getPrisma();

  const thread = await db.redditThread.findUnique({
    where:   { id: threadDbId },
    include: { replies: { orderBy: { variant: 'asc' } } },
  });
  if (!thread) throw new Error(`Thread not found: ${threadDbId}`);
  if (!thread.replies.length) throw new Error(`No replies generated for thread ${threadDbId}`);

  const message = buildSlackMessage(thread, thread.replies, appBaseUrl || 'https://your-app.vercel.app');

  if (dryRun) {
    return { sent: false, message, dryRun: true };
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

    await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 256,
      mcp_servers: [{ type: 'url', url: 'https://mcp.slack.com/mcp', name: 'slack' }],
      messages: [{
        role:    'user',
        content: `Send this exact message to Slack channel ${channelId}. Do not paraphrase or add anything.\n\n${message}`,
      }],
    });

    const now = new Date();
    await db.redditThread.update({ where: { id: threadDbId }, data: { status: 'NOTIFIED' } });
    await db.redditReply.updateMany({ where: { threadId: threadDbId }, data: { slackNotifiedAt: now } });

    return { sent: true, message };
  } catch (err) {
    return { sent: false, message, error: err.message };
  }
}

module.exports = { buildSlackMessage, notifySlack };
