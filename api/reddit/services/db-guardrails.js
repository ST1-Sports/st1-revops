/**
 * Reddit Engagement Module — database-level guardrail checker.
 *
 * Runs before evaluation to determine whether a candidate thread should be
 * processed. Checks (in order):
 *   1. Minimum score threshold (REDDIT_MIN_THREAD_SCORE, default 5)
 *   2. Subreddit mute list
 *   3. Keyword mute list
 *   4. Deduplication — thread already exists in DB
 *   5. Daily post cap (when postingEnabled flag is set)
 *
 * Separate from content-guardrail.js (Claude-based content review).
 * Also provides mute-list management functions and post action logging.
 */

const { getPrisma } = require('./_prisma');

/**
 * Check all DB guardrails for a candidate thread.
 *
 * @param {import('../types').CandidateThread} thread
 * @param {import('../types').RedditFlags}     flags
 * @returns {Promise<{ pass: boolean, failures: string[], muteReason?: string, isDuplicate: boolean, rateLimited: boolean }>}
 */
async function checkGuardrails(thread, flags) {
  const failures = [];
  let muteReason;
  let isDuplicate = false;
  let rateLimited = false;

  const db = getPrisma();
  const minScore = flags.minThreadScore ?? 5;

  if (thread.score < minScore) {
    failures.push(`Thread score ${thread.score} is below minimum ${minScore}`);
  }

  // ── Env-level subreddit mute (REDDIT_MUTED_SUBREDDITS) ────────────────────
  const envMutedSubs = (process.env.REDDIT_MUTED_SUBREDDITS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (envMutedSubs.includes(thread.subreddit.toLowerCase())) {
    muteReason = `Subreddit r/${thread.subreddit} is muted (env)`;
    failures.push(muteReason);
  }

  // ── Env-level keyword mute (REDDIT_MUTED_KEYWORDS) ────────────────────────
  if (!muteReason) {
    const envMutedKws = (process.env.REDDIT_MUTED_KEYWORDS || '')
      .split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const searchText = `${thread.title} ${thread.body}`.toLowerCase();
    const matchedKw = envMutedKws.find(kw => searchText.includes(kw));
    if (matchedKw) {
      muteReason = `Keyword mute matched: "${matchedKw}" (env)`;
      failures.push(muteReason);
    }
  }

  // ── DB subreddit mute ──────────────────────────────────────────────────────
  const subredditMute = !muteReason && await db.redditMute.findUnique({
    where: { type_value: { type: 'subreddit', value: thread.subreddit.toLowerCase() } },
  }).catch(() => null);

  if (subredditMute) {
    muteReason = `Subreddit r/${thread.subreddit} is muted`;
    failures.push(muteReason);
  }

  // ── DB keyword mute ────────────────────────────────────────────────────────
  if (!muteReason) {
    const keywordMutes = await db.redditMute.findMany({ where: { type: 'keyword' } }).catch(() => []);
    const searchText = `${thread.title} ${thread.body}`.toLowerCase();
    for (const km of keywordMutes) {
      if (searchText.includes(km.value.toLowerCase())) {
        muteReason = `Keyword mute matched: "${km.value}"`;
        failures.push(muteReason);
        break;
      }
    }
  }

  const existingThread = await db.redditThread.findUnique({
    where:  { redditId: thread.redditId },
    select: { id: true, status: true },
  }).catch(() => null);

  if (existingThread) {
    isDuplicate = true;
    failures.push(`Thread ${thread.redditId} already ingested (status: ${existingThread.status})`);
  }

  if (flags.postingEnabled) {
    const maxPosts = flags.dailyPostLimit ?? 3;
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

  return { pass: failures.length === 0, failures, muteReason, isDuplicate, rateLimited };
}

/**
 * Log a posting action to the rate-limit table.
 * Call immediately after a successful Reddit post.
 */
async function logPostAction() {
  const db = getPrisma();
  await db.redditRateLog.create({ data: { action: 'post' } });
}

/**
 * Add a subreddit to the mute list (idempotent).
 * @param {string} subreddit
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
 * Add a keyword to the mute list (idempotent).
 * @param {string} keyword
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
