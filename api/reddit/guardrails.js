/**
 * Reddit Engagement Module — guardrail checker.
 *
 * Runs before evaluation to determine whether a candidate thread should be
 * processed. Checks (in order):
 *   1. Subreddit mute list (RedditMute table)
 *   2. Keyword mute list (RedditMute table)
 *   3. Deduplication — thread already has a reply record in DB
 *   4. Rate limit — daily post cap not exceeded
 *   5. Minimum score threshold (env var REDDIT_MIN_THREAD_SCORE)
 *
 * Returns a GuardrailResult. Callers must check `result.pass` before
 * continuing the workflow; a failing thread should be marked SKIPPED.
 *
 * TODO (Phase 3): wire Prisma queries when DB is available in the environment.
 *                 Current implementation returns a deterministic placeholder.
 */

const { PrismaClient } = require('@prisma/client');

// Reuse a single Prisma instance per function invocation (Vercel best practice)
let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Check all guardrails for a candidate thread.
 *
 * @param {import('./types').CandidateThread} thread
 * @param {import('./types').RedditFlags}     flags
 * @returns {Promise<import('./types').GuardrailResult>}
 */
async function checkGuardrails(thread, flags) {
  const failures = [];
  let muteReason;
  let isDuplicate = false;
  let rateLimited = false;

  const db = getPrisma();
  const minScore = flags.minThreadScore ?? 5;

  // 1. Minimum score filter
  if (thread.score < minScore) {
    failures.push(`Thread score ${thread.score} is below minimum ${minScore}`);
  }

  // 2. Subreddit mute
  const subredditMute = await db.redditMute.findUnique({
    where: { type_value: { type: 'subreddit', value: thread.subreddit.toLowerCase() } },
  }).catch(() => null);

  if (subredditMute) {
    muteReason = `Subreddit r/${thread.subreddit} is muted`;
    failures.push(muteReason);
  }

  // 3. Keyword mute — check thread title + body against all keyword mutes
  if (!subredditMute) {
    const keywordMutes = await db.redditMute.findMany({
      where: { type: 'keyword' },
    }).catch(() => []);

    const searchText = `${thread.title} ${thread.body}`.toLowerCase();
    for (const km of keywordMutes) {
      if (searchText.includes(km.value.toLowerCase())) {
        muteReason = `Keyword mute matched: "${km.value}"`;
        failures.push(muteReason);
        break;
      }
    }
  }

  // 4. Deduplication — do we already have a reply (any status) for this thread?
  const existingThread = await db.redditThread.findUnique({
    where: { redditId: thread.redditId },
    select: { id: true, status: true },
  }).catch(() => null);

  if (existingThread) {
    isDuplicate = true;
    failures.push(`Thread ${thread.redditId} already ingested (status: ${existingThread.status})`);
  }

  // 5. Daily post rate limit
  if (flags.postingEnabled) {
    const maxPosts = flags.maxPostsPerDay ?? 3;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const todayCount = await db.redditRateLog.count({
      where: { action: 'post', createdAt: { gte: dayStart } },
    }).catch(() => 0);

    if (todayCount >= maxPosts) {
      rateLimited = true;
      failures.push(`Daily post cap reached (${todayCount}/${maxPosts})`);
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    muteReason,
    isDuplicate,
    rateLimited,
  };
}

/**
 * Log a posting action to the rate-limit table.
 * Call this immediately after a successful Reddit post.
 *
 * @returns {Promise<void>}
 */
async function logPostAction() {
  const db = getPrisma();
  await db.redditRateLog.create({ data: { action: 'post' } });
}

/**
 * Add a subreddit to the mute list.
 *
 * @param {string} subreddit
 * @returns {Promise<void>}
 */
async function muteSubreddit(subreddit) {
  const db = getPrisma();
  await db.redditMute.upsert({
    where:  { type_value: { type: 'subreddit', value: subreddit.toLowerCase() } },
    create: { type: 'subreddit', value: subreddit.toLowerCase() },
    update: {},
  });
}

/**
 * Add a keyword to the mute list.
 *
 * @param {string} keyword
 * @returns {Promise<void>}
 */
async function muteKeyword(keyword) {
  const db = getPrisma();
  await db.redditMute.upsert({
    where:  { type_value: { type: 'keyword', value: keyword.toLowerCase() } },
    create: { type: 'keyword', value: keyword.toLowerCase() },
    update: {},
  });
}

module.exports = { checkGuardrails, logPostAction, muteSubreddit, muteKeyword };
