/**
 * /api/cron/reddit-daily — Daily Reddit opportunity pipeline
 *
 * Runs every weekday morning (8am MT). Flow:
 *   1. Claude generates smart search queries for today
 *   2. Search Reddit for matching threads and save PENDING ones to DB
 *   3. Claude evaluates each PENDING thread (fit score, intent, decision)
 *   4. Claude generates reply variants for REPLY-decision threads
 *
 * Results are then visible in the Reddit Engagement UI for human review and posting.
 *
 * Authorization: Bearer ${CRON_SECRET} header required in production.
 */

const { generateSearchQueries } = require('../reddit/services/query-generator');
const { ingestThreads }         = require('../reddit/services/ingestion');
const { evaluateThread }        = require('../reddit/services/evaluator');
const { generateReplies }       = require('../reddit/services/reply-generator');
const { PrismaClient }          = require('@prisma/client');

let _prisma;
function getPrisma() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const results = {
    queriesGenerated: 0,
    ingested: 0,
    skipped: 0,
    evaluated: 0,
    replyThreads: 0,
    generated: 0,
    errors: [],
  };

  try {
    // ── Step 1: Claude generates smart search queries ────────────────────────
    console.log('[reddit-daily] generating search queries via Claude…');
    let queries = [];
    try {
      queries = await generateSearchQueries();
      results.queriesGenerated = queries.length;
      console.log(`[reddit-daily] ${queries.length} queries generated`);
    } catch (e) {
      console.error('[reddit-daily] query generation error:', e.message);
      results.errors.push({ step: 'query-generation', error: e.message });
    }

    // ── Step 2: Search Reddit and ingest new threads ─────────────────────────
    const flags = {
      enabled: true,
      postingEnabled: process.env.REDDIT_POSTING_ENABLED === 'true',
      dryRun: false,
      dailyPostLimit: parseInt(process.env.REDDIT_DAILY_POST_LIMIT || '3', 10),
      minThreadScore: parseInt(process.env.REDDIT_MIN_THREAD_SCORE || '5', 10),
    };

    const overrides = queries.length > 0 ? {
      subreddits: [...new Set(queries.map(q => q.subreddit))],
      keywords:   [...new Set(queries.map(q => q.query))],
    } : {};

    try {
      const ingestResult = await ingestThreads(flags, overrides);
      results.ingested = ingestResult.ingested;
      results.skipped  = ingestResult.skipped;
      console.log(`[reddit-daily] ingested=${results.ingested} skipped=${results.skipped}`);
    } catch (e) {
      console.error('[reddit-daily] ingestion error:', e.message);
      results.errors.push({ step: 'ingestion', error: e.message });
    }

    // ── Step 3: Evaluate all PENDING threads ─────────────────────────────────
    const db = getPrisma();
    const pending = await db.redditThread.findMany({
      where:   { status: 'PENDING' },
      orderBy: { ingestedAt: 'desc' },
      take:    20, // stay within 120s function timeout
    });

    console.log(`[reddit-daily] evaluating ${pending.length} pending threads…`);

    for (const thread of pending) {
      try {
        const evaluation = await evaluateThread(thread.id);
        results.evaluated++;

        if (evaluation.decision === 'REPLY') {
          results.replyThreads++;

          // ── Step 4: Generate reply variants ────────────────────────────────
          try {
            const replySet = await generateReplies(thread.id);
            if (!replySet.skip) {
              results.generated++;
              console.log(`[reddit-daily] replies generated for ${thread.redditId} (score=${evaluation.fit_score})`);
            } else {
              console.log(`[reddit-daily] reply writer skipped ${thread.redditId}`);
            }
          } catch (e) {
            console.error(`[reddit-daily] generate error ${thread.id}:`, e.message);
            results.errors.push({ step: 'generate', threadId: thread.id, error: e.message });
          }
        }
      } catch (e) {
        console.error(`[reddit-daily] evaluate error ${thread.id}:`, e.message);
        results.errors.push({ step: 'evaluate', threadId: thread.id, error: e.message });
      }

      await sleep(1500); // avoid Claude rate limits
    }

    console.log(`[reddit-daily] complete: evaluated=${results.evaluated} generated=${results.generated} errors=${results.errors.length}`);

    return res.json({
      ok: true,
      ...results,
      errors: results.errors.length ? results.errors : undefined,
    });

  } catch (e) {
    console.error('[reddit-daily] crashed:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
