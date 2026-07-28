/**
 * Reddit Engagement Module — Slack review notifier.
 *
 * Posts a Block Kit review card to Slack when reply variants are ready.
 * The card includes thread context, evaluator scores, both reply variants,
 * and six action buttons:
 *   Approve & Post | Approve Safer | Edit Reply
 *   Skip | Mute r/subreddit | Mute Keyword
 *
 * Action callbacks are handled by /api/slack/actions.
 *
 * Required env vars:
 *   SLACK_BOT_TOKEN             — bot token with chat:write scope
 *   SLACK_REDDIT_REVIEW_CHANNEL — channel ID (bot must be invited to the channel)
 */

const { getPrisma } = require('./_prisma');

function trunc(str, max) {
  if (!str) return '';
  return str.length <= max ? str : str.slice(0, max) + '\u2026';
}

function detectKeyword(thread) {
  const keywords = (process.env.REDDIT_BRAND_KEYWORDS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (!keywords.length) return '';
  const haystack = `${thread.title} ${thread.body || ''}`.toLowerCase();
  return keywords.find(k => haystack.includes(k.toLowerCase())) || '';
}

/**
 * Build the Slack Block Kit blocks for a thread review message.
 *
 * @param {Object}   thread     - RedditThread DB record (with evaluation JSON)
 * @param {Object[]} replies    - RedditReply records ordered variant asc
 * @param {string}   appBaseUrl - RevOps deployment URL
 * @returns {Object[]}          - Slack Block Kit blocks array
 */
function buildSlackBlocks(thread, replies, appBaseUrl) {
  const ev      = thread.evaluation || {};
  const primary = replies.find(r => r.variant === 1);
  const safer   = replies.find(r => r.variant === 2);
  const keyword = detectKeyword(thread);

  const vApprovePost  = JSON.stringify({ threadId: thread.id, replyId: primary?.id ?? null });
  const vApproveSafer = JSON.stringify({ threadId: thread.id, replyId: safer?.id   ?? null });
  const vEdit         = JSON.stringify({ threadId: thread.id, appBaseUrl });
  const vSkip         = JSON.stringify({ threadId: thread.id });
  const vMuteSub      = JSON.stringify({ threadId: thread.id, subreddit: thread.subreddit });
  const vMuteKw       = JSON.stringify({ threadId: thread.id, keyword, appBaseUrl });

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Reddit Review — r/${thread.subreddit}` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${thread.url}|${trunc(thread.title, 100)}>*\nScore: ${thread.score} · Comments: ${thread.commentCount}`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Fit score*\n${ev.fit_score    ?? '?'}/10` },
        { type: 'mrkdwn', text: `*Promo risk*\n${ev.promo_risk  ?? '?'}/10` },
        { type: 'mrkdwn', text: `*Intent*\n${ev.intent_type     ?? 'unknown'}` },
        { type: 'mrkdwn', text: `*Audience*\n${ev.audience_type ?? 'unknown'}` },
      ],
    },
  ];

  if (ev.reasoning_summary) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Reasoning:* ${trunc(ev.reasoning_summary, 200)}` },
    });
  }

  if (ev.value_angle) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Value angle: ${ev.value_angle}` }],
    });
  }

  blocks.push({ type: 'divider' });

  if (primary) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*PRIMARY REPLY*\n\`\`\`${trunc(primary.content, 280)}\`\`\`` },
    });
  }

  if (safer) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*SAFER REPLY*\n\`\`\`${trunc(safer.content, 280)}\`\`\`` },
    });
  }

  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'actions',
    block_id: 'reddit_primary_actions',
    elements: [
      {
        type: 'button', style: 'primary', action_id: 'approve_post',
        text: { type: 'plain_text', text: 'Approve & Post' }, value: vApprovePost,
      },
      {
        type: 'button', action_id: 'approve_safer',
        text: { type: 'plain_text', text: 'Approve Safer' }, value: vApproveSafer,
      },
      {
        type: 'button', action_id: 'edit_reply',
        text: { type: 'plain_text', text: 'Edit Reply' }, value: vEdit,
      },
    ],
  });

  blocks.push({
    type: 'actions',
    block_id: 'reddit_secondary_actions',
    elements: [
      {
        type: 'button', style: 'danger', action_id: 'skip_thread',
        text: { type: 'plain_text', text: 'Skip' }, value: vSkip,
        confirm: {
          title:   { type: 'plain_text', text: 'Skip this thread?' },
          text:    { type: 'mrkdwn', text: 'The thread will be marked rejected and removed from the queue.' },
          confirm: { type: 'plain_text', text: 'Skip' },
          deny:    { type: 'plain_text', text: 'Cancel' },
        },
      },
      {
        type: 'button', action_id: 'mute_subreddit',
        text:  { type: 'plain_text', text: `Mute r/${thread.subreddit}` }, value: vMuteSub,
        confirm: {
          title:   { type: 'plain_text', text: `Mute r/${thread.subreddit}?` },
          text:    { type: 'mrkdwn', text: 'Future threads from this subreddit will be filtered out.' },
          confirm: { type: 'plain_text', text: 'Mute' },
          deny:    { type: 'plain_text', text: 'Cancel' },
        },
      },
      {
        type: 'button', action_id: 'mute_keyword',
        text:  { type: 'plain_text', text: keyword ? `Mute "${keyword}"` : 'Mute Keyword' }, value: vMuteKw,
      },
    ],
  });

  return blocks;
}

/**
 * Post a Block Kit review card to Slack and update thread/reply records.
 *
 * @param {string}  threadDbId
 * @param {string}  appBaseUrl
 * @param {boolean} [dryRun]
 * @returns {Promise<{ sent: boolean, blocks?: Object[], ts?: string, error?: string }>}
 */
async function notifySlack(threadDbId, appBaseUrl, dryRun = false) {
  const token     = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_REDDIT_REVIEW_CHANNEL;

  if (!token)     return { sent: false, error: 'SLACK_BOT_TOKEN not configured' };
  if (!channelId) return { sent: false, error: 'SLACK_REDDIT_REVIEW_CHANNEL not configured' };

  const db = getPrisma();

  const thread = await db.redditThread.findUnique({
    where:   { id: threadDbId },
    include: { replies: { orderBy: { variant: 'asc' } } },
  });
  if (!thread)               throw new Error(`Thread not found: ${threadDbId}`);
  if (!thread.replies.length) throw new Error(`No replies generated for thread ${threadDbId}`);

  const blocks = buildSlackBlocks(thread, thread.replies, appBaseUrl || '');

  if (dryRun) return { sent: false, blocks, dryRun: true };

  const resp = await fetch('https://slack.com/api/chat.postMessage', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      channel: channelId,
      blocks,
      text: `Reddit thread ready for review: r/${thread.subreddit} — ${thread.title}`,
    }),
  });

  const data = await resp.json();

  if (!data.ok) return { sent: false, blocks, error: data.error || 'Slack API error' };

  const now = new Date();
  await db.redditThread.update({
    where: { id: threadDbId },
    data:  { status: 'NOTIFIED', slackMessageTs: data.ts, slackChannelId: channelId },
  });
  await db.redditReply.updateMany({
    where: { threadId: threadDbId },
    data:  { slackNotifiedAt: now },
  });

  return { sent: true, blocks, ts: data.ts };
}

module.exports = { buildSlackBlocks, notifySlack, detectKeyword };
