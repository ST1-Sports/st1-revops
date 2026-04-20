/**
 * Reddit Engagement Module — thread ingestion service.
 *
 * Searches configured subreddits for candidate threads matching brand keywords,
 * runs guardrail checks on each candidate, and persists passing threads to the
 * RedditThread table with status PENDING.
 *
 * Called by the index.js router on action="ingest".
 *
 * TODO (Phase 3): this is currently a placeholder that returns a structured
 * preview without writing to the DB. Remove the `dryRun` guard once the
 * full workflow is wired.
 */

const { searchSubreddit } = require('./reddit-client');
const { checkGuardrails }  = require('./guardrails');
const { PrismaClient }     = require('@prisma/client');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Resolve ingestion config from env vars and optional overrides.
 *
 * @param {Object} [overrides]
 * @param {string[]} [overrides.subreddits]
 * @param {string[]} [overrides.keywords]
 * @returns {{ subreddits: string[], keywords: string[] }}
 */
function resolveConfig(overrides = {}) {
  const envSubreddits = (process.env.REDDIT_TARGET_SUBREDDITS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const envKeywords = (process.env.REDDIT_BRAND_KEYWORDS || '')
    .split(',').map(k => k.trim()).filter(Boolean);

  return {
    subreddits: overrides.subreddits?.length ? overrides.subreddits : envSubreddits,
    keywords:   overrides.keywords?.length   ? overrides.keywords   : envKeywords,
  };
}

/**
 * Ingest candidate threads from Reddit.
 *
 * For each configured (subreddit × keyword) pair, searches Reddit, runs
 * guardrails on each result, and persists passing threads to the DB.
 *
 * @param {import('./types').RedditFlags} flags
 * @param {Object} [overrides]   - Optional subreddits/keywords override for manual runs
 * @param {boolean} [dryRun]     - If true, return candidates without persisting
 * @returns {Promise<{ ingested: number, skipped: number, threads: Object[] }>}
 */
async function ingestThreads(flags, overrides = {}, dryRun = false) {
  if (!flags.enabled) {
    return { ingested: 0, skipped: 0, threads: [], reason: 'REDDIT_ENABLED is false' };
  }

  const { subreddits, keywords } = resolveConfig(overrides);

  if (!subreddits.length || !keywords.length) {
    return {
      ingested: 0, skipped: 0, threads: [],
      reason: 'No target subreddits or brand keywords configured',
    };
  }

  const seen = new Set();      // dedupe within this run
  const candidates = [];
  const db = dryRun ? null : getPrisma();

  for (const subreddit of subreddits) {
    for (const keyword of keywords) {
      let results;
      try {
        results = await searchSubreddit(subreddit, keyword, 25);
      } catch (err) {
        console.error(`[reddit/ingest] search failed r/${subreddit} "${keyword}":`, err.message);
        continue;
      }

      for (const thread of results) {
        if (seen.has(thread.redditId)) continue;
        seen.add(thread.redditId);

        const guardrail = await checkGuardrails(thread, flags).catch(err => {
          console.error('[reddit/ingest] guardrail error:', err.message);
          return { pass: false, failures: ['Guardrail check threw an error'], isDuplicate: false, rateLimited: false };
        });

        if (!guardrail.pass) {
          candidates.push({ thread, status: 'skipped', reasons: guardrail.failures });
          continue;
        }

        if (!dryRun) {
          await db.redditThread.create({
            data: {
              redditId:     thread.redditId,
              subreddit:    thread.subreddit,
              title:        thread.title,
              body:         thread.body,
              url:          thread.url,
              author:       thread.author,
              score:        thread.score,
              commentCount: thread.commentCount,
              status:       'PENDING',
            },
          }).catch(err => {
            // Unique constraint = already ingested in a concurrent run; safe to ignore
            if (!err.message.includes('Unique constraint')) {
              console.error('[reddit/ingest] DB write error:', err.message);
            }
          });
        }

        candidates.push({ thread, status: 'ingested' });
      }
    }
  }

  const ingested = candidates.filter(c => c.status === 'ingested').length;
  const skipped  = candidates.filter(c => c.status === 'skipped').length;

  return { ingested, skipped, threads: candidates };
}

module.exports = { ingestThreads, resolveConfig };
