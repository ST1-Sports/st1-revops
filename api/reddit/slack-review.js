/**
 * Reddit Engagement Module — Slack review notifier.
 *
 * Sends a structured Slack notification when a thread has reply variants ready
 * for human review. The message includes:
 *   - Thread title, subreddit, score, and link
 *   - Evaluation summary (fitScore, intent, reasoning)
 *   - Both reply variants with tone labels
 *   - A direct link to the approval UI in the RevOps app
 *
 * Approval happens in the RevOps web UI (/reddit page), not via Slack buttons.
 * This keeps the implementation simple and avoids needing a Slack App with
 * interactive components configured. The Slack message is informational only.
 *
 * Uses the existing slackSend pattern: routes through /api/claude + MCP.
 * The channel is read from REDDIT_SLACK_CHANNEL env var, falling back to
 * the general integrations channel stored in app state (not accessible here,
 * so the env var is required for this service).
 *
 * TODO (Phase 4): activate when Slack channel is confirmed and end-to-end
 * flow is ready. Current implementation builds and returns the message body
 * without sending, to allow preview.
 */

const { PrismaClient } = require('@prisma/client');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Build the Slack message text for a thread review notification.
 * Returns a Slack-formatted markdown string.
 *
 * @param {Object} thread     - RedditThread DB record
 * @param {Object[]} replies  - RedditReply DB records (variant 1 and 2)
 * @param {string} appBaseUrl - Base URL of the RevOps deployment (for approval link)
 * @returns {string}
 */
function buildSlackMessage(thread, replies, appBaseUrl) {
  const evaluation = thread.evaluation || {};
  const fitScore   = evaluation.fitScore ?? '?';
  const intent     = evaluation.intent   ?? 'unknown';
  const reasoning  = evaluation.reasoning ?? '';

  const approvalUrl = `${appBaseUrl}/reddit?thread=${thread.id}`;

  const variantLines = replies.map(r =>
    `*Variant ${r.variant}* (${getVariantTone(r.variant, evaluation)})\n> ${r.content}`
  ).join('\n\n');

  return [
    `*Reddit thread ready for review*`,
    ``,
    `*Thread:* ${thread.title}`,
    `*Subreddit:* r/${thread.subreddit} · *Score:* ${thread.score} · *Comments:* ${thread.commentCount}`,
    `*Link:* ${thread.url}`,
    ``,
    `*Fit score:* ${fitScore}/10 · *Intent:* ${intent}`,
    reasoning ? `*Reasoning:* ${reasoning}` : null,
    ``,
    `*Reply variants:*`,
    variantLines,
    ``,
    `*Approve or reject in RevOps:* ${approvalUrl}`,
  ].filter(l => l !== null).join('\n');
}

/**
 * Send a Slack notification for a thread awaiting review.
 * Updates the thread status to NOTIFIED and stamps reply slackNotifiedAt.
 *
 * @param {string} threadDbId  - RedditThread.id
 * @param {string} appBaseUrl  - Base URL of the deployment, e.g. "https://app.vercel.app"
 * @param {boolean} [dryRun]   - If true, return the message body without sending
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

  // Route through the existing /api/claude + MCP pattern (same as slackSend in src/lib/api.js)
  // This function runs server-side, so we call the Anthropic SDK directly with MCP config.
  // The MCP Slack server handles the actual message delivery.
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_KEY });

    await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 256,
      mcp_servers: [{ type: 'url', url: 'https://mcp.slack.com/mcp', name: 'slack' }],
      messages: [{
        role:    'user',
        content: `Send this exact message to Slack channel ${channelId}. Do not paraphrase or add anything.\n\n${message}`,
      }],
    });

    // Update DB — thread is now awaiting human decision
    const now = new Date();
    await db.redditThread.update({
      where: { id: threadDbId },
      data:  { status: 'NOTIFIED' },
    });
    await db.redditReply.updateMany({
      where: { threadId: threadDbId },
      data:  { slackNotifiedAt: now },
    });

    return { sent: true, message };
  } catch (err) {
    return { sent: false, message, error: err.message };
  }
}

/** Map variant number to tone label from evaluation topics (best-effort). */
function getVariantTone(variantNum, evaluation) {
  // Tones are stored in the reply row — this is a fallback for display
  return variantNum === 1 ? 'direct' : 'conversational';
}

module.exports = { buildSlackMessage, notifySlack };
