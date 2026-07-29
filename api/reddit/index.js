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
 *   report          — aggregated analytics report (funnel, subreddits, variants, guardrails)
 *   threads         — list threads from DB (for review UI)
 *   mute-add        — add a subreddit or keyword to the mute list
 *   mute-list       — list all mute entries
 */

const { ingestThreads }         = require('./services/ingestion');
const { generateSearchQueries } = require('./services/query-generator');
const { evaluateThread }        = require('./services/evaluator');
const { generateReplies }       = require('./services/reply-generator');
const { muteSubreddit, muteKeyword } = require('./services/db-guardrails');
const { getPrisma } = require('./services/_prisma');


/** Resolve feature flags from env vars. @returns {import('./types').RedditFlags} */
function resolveFlags() {
  return {
    enabled:         process.env.REDDIT_AUTOMATION_ENABLED === 'true',
    postingEnabled:  process.env.REDDIT_POSTING_ENABLED    === 'true',
    dryRun:          process.env.REDDIT_DRY_RUN            === 'true',
    dailyPostLimit:  parseInt(process.env.REDDIT_DAILY_POST_LIMIT  || '3', 10),
    minThreadScore:  parseInt(process.env.REDDIT_MIN_THREAD_SCORE  || '5',  10),
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
        hasSlackChannel: Boolean(process.env.SLACK_REDDIT_REVIEW_CHANNEL),
        hasAnthropicKey: Boolean(process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY),
        targetSubreddits: (process.env.REDDIT_TARGET_SUBREDDITS || '').split(',').filter(Boolean),
        brandKeywords:    (process.env.REDDIT_BRAND_KEYWORDS    || '').split(',').filter(Boolean),
      },
    });
  }

  if (!flags.enabled) {
    return err(res, 'Reddit module is disabled. Set REDDIT_AUTOMATION_ENABLED=true to enable.', 403);
  }

  try {
    switch (action) {

      case 'ingest': {
        const result = await ingestThreads(flags, body.overrides || {}, body.dryRun === true || flags.dryRun);
        return ok(res, result);
      }

      case 'evaluate': {
        if (!body.threadId) return err(res, 'threadId is required', 400);
        const evaluation = await evaluateThread(body.threadId, {
          subredditRules: body.subredditRules || '',
          topComments:    body.topComments    || '',
          dryRun:         body.dryRun === true || flags.dryRun,
        });
        return ok(res, { evaluation });
      }

      case 'generate': {
        if (!body.threadId) return err(res, 'threadId is required', 400);
        const replySet = await generateReplies(body.threadId, {
          dryRun:             body.dryRun             === true || flags.dryRun,
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

      // mark-done: user manually posted the reply — record it and hide from queue
      case 'mark-done': {
        const { threadId } = body;
        if (!threadId) return err(res, 'threadId is required', 400);
        const db = getPrisma();
        await db.redditThread.update({
          where: { id: threadId },
          data:  { status: 'POSTED' },
        });
        return ok(res, { done: true, threadId });
      }

      // reject / skip: hide from review queue
      case 'reject': {
        const { threadId } = body;
        if (!threadId) return err(res, 'threadId is required', 400);
        const db = getPrisma();
        await db.redditThread.update({
          where: { id: threadId },
          data:  { status: 'REJECTED' },
        });
        return ok(res, { rejected: true, threadId });
      }

      // pipeline: ingest + evaluate + generate for pending threads (manual trigger from UI)
      case 'pipeline': {
        const pResults = { ingested: 0, skipped: 0, skipReasons: {}, evaluated: 0, generated: 0, errors: [] };

        // A caller-supplied { subreddits, keywords } search runs as-is,
        // bypassing Claude query generation entirely — this is what lets the
        // UI's "Custom Search" fields actually control what gets searched,
        // rather than every scan silently using AI-picked queries.
        try {
          const manualOverrides = body.overrides?.subreddits?.length || body.overrides?.keywords?.length
            ? body.overrides
            : null;
          let overrides = manualOverrides;
          if (!overrides) {
            const queries = await generateSearchQueries();
            overrides = queries.length ? {
              subreddits: [...new Set(queries.map(q => q.subreddit))],
              keywords:   [...new Set(queries.map(q => q.query))],
            } : {};
          }
          const ig = await ingestThreads(flags, overrides);
          pResults.ingested = ig.ingested;
          pResults.skipped  = ig.skipped;
          // Aggregate skip reasons so the UI can show WHY nothing landed,
          // instead of just a bare "0 found".
          for (const c of ig.threads) {
            if (c.status !== 'skipped') continue;
            for (const reason of c.reasons || []) {
              const key = reason.replace(/\d+/g, 'N'); // collapse per-thread numbers together
              pResults.skipReasons[key] = (pResults.skipReasons[key] || 0) + 1;
            }
          }
        } catch (e) {
          pResults.errors.push({ step: 'ingest', error: e.message });
        }

        // Evaluate pending threads (up to 5 to stay under 30s timeout)
        const db = getPrisma();
        const pending = await db.redditThread.findMany({
          where: { status: 'PENDING' }, take: 5, orderBy: { ingestedAt: 'desc' },
        });
        for (const thread of pending) {
          try {
            const ev = await evaluateThread(thread.id);
            pResults.evaluated++;
            if (ev.decision === 'REPLY') {
              const rs = await generateReplies(thread.id);
              if (!rs.skip) pResults.generated++;
            }
          } catch (e) {
            pResults.errors.push({ step: 'evaluate', threadId: thread.id, error: e.message });
          }
        }
        return ok(res, pResults);
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
