/**
 * Reddit Engagement Module — API entry point.
 *
 * Vercel serverless function at /api/reddit.
 * Dispatches to individual service modules based on the `action` field in the
 * POST body. All responses follow the standard repo pattern:
 *   { ok: true, data: {...} }  or  { error: "msg", status: 400|500 }
 *
 * Feature flag check is the first thing done in every action handler:
 * if REDDIT_ENABLED !== "true", all actions except "status" return 403.
 *
 * Actions:
 *   status          — return current feature flag state (always allowed)
 *   ingest          — search Reddit and store candidate threads
 *   evaluate        — run Claude evaluation on a pending thread
 *   generate        — generate reply variants for an evaluated thread
 *   notify          — send Slack notification for a thread awaiting review
 *   approve         — record human approval of a reply variant
 *   reject          — record human rejection of all variants
 *   check           — run content guardrail on a reply (Claude review before post)
 *   post            — post an approved reply to Reddit (requires REDDIT_POSTING_ENABLED)
 *   analytics       — refresh engagement metrics for posted replies
 *   threads         — list threads from DB (for review UI)
 *   mute-add        — add a subreddit or keyword to the mute list
 *   mute-list       — list all mute entries
 */

const { ingestThreads }      = require('./ingest');
const { evaluateThread }     = require('./evaluate');
const { generateReplies }    = require('./reply-gen');
const { notifySlack }        = require('./slack-review');
const { postApprovedReply }  = require('./post');
const { refreshAnalytics }   = require('./analytics');
const { muteSubreddit, muteKeyword } = require('./guardrails');
const { checkContent }       = require('./content-check');
const { PrismaClient }       = require('@prisma/client');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/** Resolve feature flags from env vars. @returns {import('./types').RedditFlags} */
function resolveFlags() {
  return {
    enabled:        process.env.REDDIT_ENABLED         === 'true',
    postingEnabled: process.env.REDDIT_POSTING_ENABLED === 'true',
    maxPostsPerDay: parseInt(process.env.REDDIT_MAX_POSTS_PER_DAY || '3', 10),
    minThreadScore: parseInt(process.env.REDDIT_MIN_THREAD_SCORE  || '5',  10),
  };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function ok(res, data)         { return res.status(200).json({ ok: true, ...data }); }
function err(res, msg, status) { return res.status(status).json({ error: msg, status }); }

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return err(res, 'Method not allowed', 405);

  const { action, ...body } = req.body || {};
  if (!action) return err(res, 'Missing action', 400);

  const flags = resolveFlags();

  // "status" is always allowed — used by the UI to show feature flag state
  if (action === 'status') {
    return ok(res, {
      flags,
      env: {
        hasClientId:     Boolean(process.env.REDDIT_CLIENT_ID),
        hasClientSecret: Boolean(process.env.REDDIT_CLIENT_SECRET),
        hasRefreshToken: Boolean(process.env.REDDIT_REFRESH_TOKEN),
        hasSlackChannel: Boolean(process.env.REDDIT_SLACK_CHANNEL),
        targetSubreddits: (process.env.REDDIT_TARGET_SUBREDDITS || '').split(',').filter(Boolean),
        brandKeywords:    (process.env.REDDIT_BRAND_KEYWORDS    || '').split(',').filter(Boolean),
      },
    });
  }

  if (!flags.enabled) {
    return err(res, 'Reddit module is disabled. Set REDDIT_ENABLED=true to enable.', 403);
  }

  try {
    switch (action) {

      case 'ingest': {
        const result = await ingestThreads(flags, body.overrides || {}, body.dryRun === true);
        return ok(res, result);
      }

      case 'evaluate': {
        if (!body.threadId) return err(res, 'threadId is required', 400);
        const evaluation = await evaluateThread(body.threadId, {
          subredditRules: body.subredditRules || '',
          topComments:    body.topComments    || '',
          dryRun:         body.dryRun === true,
        });
        return ok(res, { evaluation });
      }

      case 'generate': {
        if (!body.threadId) return err(res, 'threadId is required', 400);
        const replySet = await generateReplies(body.threadId, {
          dryRun:             body.dryRun             === true,
          allowVendorMention: body.allowVendorMention === true,
          allowLinks:         body.allowLinks         === true,
          subredditRules:     body.subredditRules     || '',
          topComments:        body.topComments        || '',
        });
        // Claude returned SKIP — no value-add for this thread
        if (replySet.skip) {
          const db = getPrisma();
          await db.redditThread.update({
            where: { id: body.threadId },
            data:  { status: 'SKIPPED' },
          });
          return ok(res, { skip: true, reason: 'Reply writer found no credible value-add for this thread' });
        }
        return ok(res, { replySet });
      }

      case 'notify': {
        if (!body.threadId) return err(res, 'threadId is required', 400);
        const appBaseUrl = body.appBaseUrl || `https://${req.headers.host}`;
        const result = await notifySlack(body.threadId, appBaseUrl, body.dryRun === true);
        return ok(res, result);
      }

      case 'approve': {
        // Validate the approval payload then record it in the DB
        const { threadId, replyId, decidedBy } = body;
        if (!threadId || !replyId) return err(res, 'threadId and replyId are required', 400);

        const db = getPrisma();
        await db.redditReply.update({
          where: { id: replyId },
          data:  { approvedBy: decidedBy || 'unknown', approvedAt: new Date(), rejectedAt: null },
        });
        await db.redditThread.update({
          where: { id: threadId },
          data:  { status: 'APPROVED' },
        });
        return ok(res, { approved: true, replyId });
      }

      case 'reject': {
        const { threadId, decidedBy, reason } = body;
        if (!threadId) return err(res, 'threadId is required', 400);

        const db = getPrisma();
        await db.redditReply.updateMany({
          where: { threadId },
          data:  { rejectedAt: new Date(), rejectionReason: reason || null },
        });
        await db.redditThread.update({
          where: { id: threadId },
          data:  { status: 'REJECTED' },
        });
        return ok(res, { rejected: true, threadId });
      }

      case 'check': {
        if (!body.replyId) return err(res, 'replyId is required', 400);
        const guardrail = await checkContent(body.replyId, {
          subredditRules: body.subredditRules || '',
          topComments:    body.topComments    || '',
          dryRun:         body.dryRun === true,
        });
        return ok(res, { guardrail });
      }

      case 'post': {
        if (!body.replyId) return err(res, 'replyId is required', 400);
        const result = await postApprovedReply(body.replyId);
        return ok(res, { result });
      }

      case 'analytics': {
        const records = await refreshAnalytics(body.dryRun === true);
        return ok(res, { records });
      }

      case 'threads': {
        const db = getPrisma();
        const threads = await db.redditThread.findMany({
          orderBy: { ingestedAt: 'desc' },
          take:    body.limit || 50,
          where:   body.status ? { status: body.status } : undefined,
          include: { replies: { orderBy: { variant: 'asc' } } },
        });
        return ok(res, { threads });
      }

      case 'mute-add': {
        const { type, value } = body;
        if (!type || !value) return err(res, 'type and value are required', 400);
        if (type === 'subreddit') await muteSubreddit(value);
        else if (type === 'keyword') await muteKeyword(value);
        else return err(res, 'type must be "subreddit" or "keyword"', 400);
        return ok(res, { muted: true, type, value });
      }

      case 'mute-list': {
        const db = getPrisma();
        const mutes = await db.redditMute.findMany({ orderBy: { createdAt: 'desc' } });
        return ok(res, { mutes });
      }

      default:
        return err(res, `Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[reddit/index] Unhandled error:', e);
    return err(res, e.message || 'Internal server error', 500);
  }
}
