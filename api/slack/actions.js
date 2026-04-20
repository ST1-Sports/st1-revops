/**
 * Slack interactive actions handler — /api/slack/actions
 *
 * Vercel serverless function that receives block_actions payloads from Slack
 * when a user clicks a button in the Reddit review card.
 *
 * Handled actions:
 *   approve_post    — record approval; post to Reddit if REDDIT_POSTING_ENABLED=true
 *   approve_safer   — same, but for the safer variant
 *   edit_reply      — ephemeral link to web UI (TODO: Slack modal)
 *   skip_thread     — reject thread and all reply variants
 *   mute_subreddit  — add subreddit to mute list
 *   mute_keyword    — add keyword to mute list; ephemeral if no keyword detected
 *
 * Security: verifies Slack request signature using SLACK_SIGNING_SECRET.
 * Set SLACK_SIGNING_SECRET in env. If unset, signature verification is skipped
 * (dev only — never skip in production).
 *
 * Slack expects a 200 response within 3 seconds. We ack immediately and process
 * async, then update the original message via response_url.
 *
 * Required env vars:
 *   SLACK_SIGNING_SECRET — from your Slack app's "Basic Information" page
 *   SLACK_BOT_TOKEN      — bot token with chat:write scope (used for updates)
 *   REDDIT_POSTING_ENABLED — "true" to allow actual Reddit posting on approve
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { postApprovedReply } from '../reddit/post.js';
import { muteSubreddit, muteKeyword } from '../reddit/guardrails.js';

// Disable Vercel's automatic body parser so we can read the raw body
// for Slack signature verification.
export const config = { api: { bodyParser: false } };

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/** Read the raw request body as a UTF-8 string. */
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk.toString('utf8'); });
    req.on('end',   () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * Verify the Slack request signature.
 * Returns true if valid (or if SLACK_SIGNING_SECRET is not set).
 *
 * @param {import('http').IncomingMessage} req
 * @param {string} rawBody
 * @returns {boolean}
 */
function verifySignature(req, rawBody) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    console.warn('[slack/actions] SLACK_SIGNING_SECRET not set — skipping signature verification');
    return true;
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSig  = req.headers['x-slack-signature'];
  if (!timestamp || !slackSig) return false;

  // Reject requests older than 5 minutes (replay attack prevention)
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false;

  const sigBase  = `v0:${timestamp}:${rawBody}`;
  const computed = 'v0=' + crypto.createHmac('sha256', secret).update(sigBase).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSig));
  } catch {
    return false;
  }
}

/**
 * Send a response to Slack via response_url.
 * replace_original=true replaces the card; false sends an ephemeral follow-up.
 *
 * @param {string}  responseUrl
 * @param {string}  text
 * @param {boolean} [replaceOriginal]
 */
async function respond(responseUrl, text, replaceOriginal = false) {
  await fetch(responseUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      replace_original: replaceOriginal,
      response_type: replaceOriginal ? 'in_channel' : 'ephemeral',
    }),
  });
}

/**
 * Replace the original review card with a compact status message (no buttons).
 * Used after approve / skip / mute to prevent duplicate actions.
 *
 * @param {string} responseUrl
 * @param {string} statusLine  - e.g. "Approved by @matt — posting to Reddit…"
 * @param {string} threadTitle
 * @param {string} subreddit
 */
async function replaceCard(responseUrl, statusLine, threadTitle, subreddit) {
  await fetch(responseUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      replace_original: true,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*r/${subreddit}* — ${threadTitle}\n${statusLine}`,
          },
        },
      ],
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Action handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleApprove({ threadId, replyId }, decidedBy, responseUrl, thread) {
  if (!replyId) {
    await respond(responseUrl, 'Reply ID missing — approve from the web UI instead.');
    return;
  }

  const db = getPrisma();

  // Record approval
  await db.redditReply.update({
    where: { id: replyId },
    data:  { approvedBy: decidedBy, approvedAt: new Date(), rejectedAt: null },
  });
  await db.redditThread.update({
    where: { id: threadId },
    data:  { status: 'APPROVED' },
  });

  const postingEnabled = process.env.REDDIT_POSTING_ENABLED === 'true';

  if (!postingEnabled) {
    await replaceCard(
      responseUrl,
      `Approved by @${decidedBy} — posting is disabled, queued for manual execution.`,
      thread.title,
      thread.subreddit,
    );
    console.log(`[slack/actions] approve:${replyId} by ${decidedBy} — posting disabled`);
    return;
  }

  // Replace card immediately so the user sees feedback
  await replaceCard(
    responseUrl,
    `Approved by @${decidedBy} — posting to Reddit\u2026`,
    thread.title,
    thread.subreddit,
  );

  try {
    const result = await postApprovedReply(replyId, { decidedBy });
    console.log(`[slack/actions] post:${replyId} result:`, result.ok, result.commentId || result.error);

    if (result.ok) {
      await respond(responseUrl, `Posted: ${result.commentUrl || 'see Reddit'}`);
    } else if (result.wasDisabled) {
      await respond(responseUrl, 'Posted approval recorded. Posting is disabled — execute manually.');
    } else {
      await respond(responseUrl, `Post attempt failed: ${result.error}`);
    }
  } catch (err) {
    console.error('[slack/actions] postApprovedReply error:', err);
    await respond(responseUrl, `Approval recorded. Post failed: ${err.message}`);
  }
}

async function handleSkip({ threadId }, decidedBy, responseUrl, thread) {
  const db = getPrisma();

  await db.redditReply.updateMany({
    where: { threadId },
    data:  { rejectedAt: new Date(), rejectionReason: `Skipped via Slack by ${decidedBy}` },
  });
  await db.redditThread.update({
    where: { id: threadId },
    data:  { status: 'REJECTED' },
  });

  console.log(`[slack/actions] skip:${threadId} by ${decidedBy}`);

  await replaceCard(
    responseUrl,
    `Skipped by @${decidedBy}.`,
    thread.title,
    thread.subreddit,
  );
}

async function handleMuteSubreddit({ subreddit, threadId }, decidedBy, responseUrl, thread) {
  await muteSubreddit(subreddit);
  console.log(`[slack/actions] mute-subreddit:${subreddit} by ${decidedBy}`);

  await replaceCard(
    responseUrl,
    `r/${subreddit} muted by @${decidedBy}. Future threads will be filtered.`,
    thread.title,
    subreddit,
  );
}

async function handleMuteKeyword({ keyword, threadId, appBaseUrl }, decidedBy, responseUrl, thread) {
  if (!keyword) {
    // TODO: open a Slack modal for keyword input (requires views.open + trigger_id)
    // For now, direct the user to the web UI.
    const url = appBaseUrl ? `${appBaseUrl}/reddit?thread=${threadId}` : '/reddit';
    await respond(
      responseUrl,
      `No brand keyword auto-detected for this thread. Mute a keyword manually in the RevOps UI: ${url}`,
    );
    return;
  }

  await muteKeyword(keyword);
  console.log(`[slack/actions] mute-keyword:${keyword} by ${decidedBy}`);
  await respond(responseUrl, `Keyword muted by @${decidedBy}: "${keyword}". Threads matching this keyword will be filtered.`);
}

async function handleEditReply({ threadId, appBaseUrl }, decidedBy, responseUrl) {
  // TODO: implement as a Slack modal (views.open) when the app has a modal framework.
  // Requires: trigger_id from payload, SLACK_BOT_TOKEN with views:open scope,
  // and a new /api/slack/modal-submit handler for the submission.
  const url = appBaseUrl ? `${appBaseUrl}/reddit?thread=${threadId}` : '/reddit';
  await respond(responseUrl, `Edit this reply in the RevOps UI: ${url}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'GET')  return res.status(200).end('ok');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await getRawBody(req);

  if (!verifySignature(req, rawBody)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Slack sends URL-encoded body with a `payload` field containing JSON
  const params  = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get('payload') || 'null');

  if (!payload || payload.type !== 'block_actions') {
    return res.status(400).json({ error: 'Unexpected payload type' });
  }

  const action      = payload.actions?.[0];
  const actionId    = action?.action_id;
  const value       = JSON.parse(action?.value || '{}');
  const responseUrl = payload.response_url;
  const decidedBy   = payload.user?.name || payload.user?.id || 'unknown';

  // Ack to Slack immediately — must respond within 3 seconds
  res.status(200).end();

  // Fetch thread for display context in response messages
  let thread = { title: '(unknown)', subreddit: '(unknown)', id: value.threadId };
  try {
    const db = getPrisma();
    const row = await db.redditThread.findUnique({ where: { id: value.threadId } });
    if (row) thread = row;
  } catch (e) {
    console.error('[slack/actions] thread lookup failed:', e);
  }

  try {
    switch (actionId) {
      case 'approve_post':
        await handleApprove(value, decidedBy, responseUrl, thread);
        break;

      case 'approve_safer':
        await handleApprove(value, decidedBy, responseUrl, thread);
        break;

      case 'edit_reply':
        await handleEditReply(value, decidedBy, responseUrl);
        break;

      case 'skip_thread':
        await handleSkip(value, decidedBy, responseUrl, thread);
        break;

      case 'mute_subreddit':
        await handleMuteSubreddit(value, decidedBy, responseUrl, thread);
        break;

      case 'mute_keyword':
        await handleMuteKeyword(value, decidedBy, responseUrl, thread);
        break;

      default:
        console.warn(`[slack/actions] unknown action_id: ${actionId}`);
        await respond(responseUrl, `Unknown action: ${actionId}`);
    }
  } catch (err) {
    console.error(`[slack/actions] unhandled error for ${actionId}:`, err);
    await respond(responseUrl, `Action failed: ${err.message}`);
  }
}
