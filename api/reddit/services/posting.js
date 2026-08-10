/**
 * Reddit Engagement Module — posting service.
 *
 * THIS SERVICE IS DISABLED BY DEFAULT.
 * Set REDDIT_POSTING_ENABLED=true to enable. The master flag REDDIT_AUTOMATION_ENABLED
 * must also be true; that is enforced by index.js before this function is called.
 *
 * Gates — checked in order, all must pass:
 *   1.  REDDIT_POSTING_ENABLED env flag must be exactly "true"
 *   2.  Reply must exist in DB
 *   3.  Reply must have approvedAt set (human approval recorded in the UI)
 *   4.  Reply must not already be posted (postedAt is null)
 *   5.  No other reply for this thread has been posted (one per thread)
 *   6.  Thread's subreddit must not appear in the mute list
 *   7.  Thread title/body must not contain a muted keyword
 *   8.  Daily post cap not exceeded (REDDIT_MAX_POSTS_PER_DAY, default 3)
 *   9.  Cooldown between posts not violated (REDDIT_POST_COOLDOWN_MINUTES, default 30)
 *   10. Reply content must not be too similar to a recently posted reply (Jaccard < 0.85)
 *   11. Content guardrail (Claude) must approve_for_post
 *
 * Every attempt — including blocked ones — is written to RedditPostingAttempt
 * so there is a full audit trail. A logging failure never aborts the posting flow.
 *
 * Dry-run mode: runs gates 1–9, skips the Claude guardrail and Reddit API call,
 * persists the attempt with dryRun=true.
 *
 * No stealth, anti-detection, or deceptive behavior. All posting is via the
 * official Reddit OAuth2 API with a compliant User-Agent header.
 */

const { postComment }   = require('../reddit-client');
const { logPostAction } = require('./db-guardrails');
const { checkContent }  = require('./content-guardrail');
const { _jaccardWords } = require('../validators');
const { getPrisma }     = require('./_prisma');


const SIMILARITY_LOOKBACK_DAYS = 14;

/**
 * Attempt to post an approved reply to Reddit.
 *
 * @param {string}  replyDbId
 * @param {Object}  [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {string}  [opts.decidedBy='system']
 * @returns {Promise<import('../types').PostingResult>}
 */
async function postApprovedReply(replyDbId, opts = {}) {
  const { dryRun = false, decidedBy = 'system' } = opts;
  const log = makeLogger(replyDbId);

  // ── Gate 1: feature flag ───────────────────────────────────────────────────
  if (process.env.REDDIT_POSTING_ENABLED !== 'true') {
    const msg = 'REDDIT_POSTING_ENABLED is not "true"';
    log('BLOCKED', 'flag', msg);
    return blocked(msg, 'flag');
  }

  const db = getPrisma();

  const reply = await db.redditReply.findUnique({
    where: { id: replyDbId }, include: { thread: true },
  });
  if (!reply) {
    const msg = `Reply not found: ${replyDbId}`;
    log('BLOCKED', 'not_found', msg);
    return blocked(msg, 'not_found');
  }

  const { thread } = reply;

  // ── Gate 2: human approval ─────────────────────────────────────────────────
  if (!reply.approvedAt) {
    const msg = 'Reply has not been approved — approve in the RevOps UI first';
    log('BLOCKED', 'not_approved', msg);
    await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, blockedBy: 'not_approved', error: msg, dryRun, decidedBy });
    return blocked(msg, 'not_approved');
  }

  // ── Gate 3: not already posted ─────────────────────────────────────────────
  if (reply.postedAt) {
    const msg = `Reply already posted at ${reply.postedAt.toISOString()} (${reply.redditCommentId})`;
    log('BLOCKED', 'already_posted', msg);
    await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, blockedBy: 'already_posted', error: msg, dryRun, decidedBy });
    return blocked(msg, 'already_posted');
  }

  // ── Gate 4: one reply per thread ───────────────────────────────────────────
  const existingPost = await db.redditReply.findFirst({
    where:  { threadId: thread.id, postedAt: { not: null } },
    select: { id: true, redditCommentId: true },
  });
  if (existingPost) {
    const msg = `Thread already has a posted reply (${existingPost.redditCommentId}) — one reply per thread max`;
    log('BLOCKED', 'one_per_thread', msg);
    await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, blockedBy: 'one_per_thread', error: msg, dryRun, decidedBy });
    return blocked(msg, 'one_per_thread');
  }

  // ── Gate 5: subreddit mute ─────────────────────────────────────────────────
  const subMute = await db.redditMute.findUnique({
    where: { type_value: { type: 'subreddit', value: thread.subreddit.toLowerCase() } },
  }).catch(() => null);
  if (subMute) {
    const msg = `Subreddit r/${thread.subreddit} is muted`;
    log('BLOCKED', 'mute_subreddit', msg);
    await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, blockedBy: 'mute_subreddit', error: msg, dryRun, decidedBy });
    return blocked(msg, 'mute_subreddit');
  }

  // ── Gate 6: keyword mute ───────────────────────────────────────────────────
  const keywordMutes = await db.redditMute.findMany({ where: { type: 'keyword' } }).catch(() => []);
  const haystack = `${thread.title} ${thread.body || ''}`.toLowerCase();
  const matchedKw = keywordMutes.find(km => haystack.includes(km.value.toLowerCase()));
  if (matchedKw) {
    const msg = `Keyword mute matched: "${matchedKw.value}"`;
    log('BLOCKED', 'mute_keyword', msg);
    await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, blockedBy: 'mute_keyword', error: msg, dryRun, decidedBy });
    return blocked(msg, 'mute_keyword');
  }

  // ── Gate 7: daily post cap ─────────────────────────────────────────────────
  const maxPostsPerDay = parseInt(process.env.REDDIT_DAILY_POST_LIMIT || '3', 10);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayCount = await db.redditRateLog.count({
    where: { action: 'post', createdAt: { gte: dayStart } },
  }).catch(() => 0);
  if (todayCount >= maxPostsPerDay) {
    const msg = `Daily post cap reached (${todayCount}/${maxPostsPerDay})`;
    log('BLOCKED', 'daily_cap', msg);
    await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, blockedBy: 'daily_cap', error: msg, dryRun, decidedBy });
    return blocked(msg, 'daily_cap');
  }

  // ── Gate 8: cooldown between posts ────────────────────────────────────────
  const cooldownMinutes = parseInt(process.env.REDDIT_POST_COOLDOWN_MINUTES || '30', 10);
  const lastPost = await db.redditRateLog.findFirst({
    where: { action: 'post' }, orderBy: { createdAt: 'desc' },
  }).catch(() => null);
  if (lastPost) {
    const elapsedMins = (Date.now() - lastPost.createdAt.getTime()) / 60_000;
    if (elapsedMins < cooldownMinutes) {
      const waitMins = Math.ceil(cooldownMinutes - elapsedMins);
      const msg = `Post cooldown active — ${waitMins} min remaining (cooldown: ${cooldownMinutes} min)`;
      log('BLOCKED', 'cooldown', msg);
      await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, blockedBy: 'cooldown', error: msg, dryRun, decidedBy });
      return blocked(msg, 'cooldown');
    }
  }

  // ── Gate 9: similarity against recent posts ────────────────────────────────
  const lookbackDate = new Date(Date.now() - SIMILARITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const recentReplies = await db.redditReply.findMany({
    where:  { postedAt: { gte: lookbackDate }, redditCommentId: { not: null } },
    select: { id: true, content: true, redditCommentId: true },
  }).catch(() => []);

  const similarityThreshold = parseFloat(process.env.REDDIT_MAX_SIMILARITY_THRESHOLD || '0.85');
  for (const recent of recentReplies) {
    const similarity = _jaccardWords(reply.content, recent.content);
    if (similarity > similarityThreshold) {
      const msg = `Reply too similar (${(similarity * 100).toFixed(0)}% word overlap, threshold ${(similarityThreshold * 100).toFixed(0)}%) to recently posted comment ${recent.redditCommentId}`;
      log('BLOCKED', 'similarity', msg);
      await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, blockedBy: 'similarity', error: msg, dryRun, decidedBy });
      return blocked(msg, 'similarity');
    }
  }

  // ── Dry-run exit ──────────────────────────────────────────────────────────
  if (dryRun) {
    log('DRY_RUN', 'gates_1_9_passed', 'Stopping before content guardrail — dry-run mode');
    await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, attempted: false, ok: true, dryRun: true, decidedBy });
    return {
      ok: true, httpStatus: 0, wasDisabled: false, dryRun: true,
      message: 'Dry run: gates 1–9 passed, guardrail and API call skipped',
    };
  }

  // ── Gate 10: content guardrail (Claude) ───────────────────────────────────
  log('INFO', 'guardrail', 'Running content guardrail check');
  let guardrail;
  try {
    guardrail = await checkContent(replyDbId, { calledFrom: 'post_gate' });
  } catch (err) {
    const msg = `Content guardrail threw: ${err.message}`;
    log('ERROR', 'guardrail_error', msg);
    await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, blockedBy: 'guardrail_error', error: msg, dryRun, decidedBy });
    return blocked(msg, 'guardrail_error');
  }
  if (!guardrail.approved_for_post) {
    const msg = `Content guardrail blocked: ${guardrail.block_reason}` +
                (guardrail.edit_suggestion ? ` — suggestion: ${guardrail.edit_suggestion}` : '');
    log('BLOCKED', 'guardrail', msg);
    await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, blockedBy: 'guardrail', error: msg, dryRun, decidedBy });
    return blocked(msg, 'guardrail');
  }
  log('INFO', 'guardrail', `Approved (risk score: ${guardrail.final_risk_score})`);

  // ── Post to Reddit ─────────────────────────────────────────────────────────
  log('INFO', 'api', `Posting to Reddit — thread ${thread.redditId} in r/${thread.subreddit}`);
  let result;
  try {
    result = await postComment(thread.redditId, reply.content);
  } catch (err) {
    const msg = `Reddit API call threw: ${err.message}`;
    log('ERROR', 'api_error', msg);
    await saveAttempt(db, { replyId: replyDbId, threadId: thread.id, attempted: true, ok: false, httpStatus: 0, error: msg, dryRun: false, decidedBy });
    return { ok: false, httpStatus: 0, wasDisabled: false, error: msg };
  }

  await saveAttempt(db, {
    replyId:    replyDbId,
    threadId:   thread.id,
    attempted:  true,
    ok:         result.ok,
    httpStatus: result.httpStatus,
    commentId:  result.commentId  ?? null,
    commentUrl: result.commentUrl ?? null,
    error:      result.error      ?? null,
    dryRun:     false,
    decidedBy,
  });

  if (result.ok) {
    log('SUCCESS', 'posted', `Comment posted: ${result.commentId} — ${result.commentUrl}`);
    await logPostAction();
    await db.redditReply.update({
      where: { id: replyDbId },
      data:  { postedAt: new Date(), redditCommentId: result.commentId || null },
    });
    await db.redditThread.update({
      where: { id: thread.id },
      data:  { status: 'POSTED' },
    });
  } else {
    log('FAILED', 'api_rejected', `Reddit rejected the post: ${result.error} (HTTP ${result.httpStatus})`);
  }

  return result;
}

function blocked(error, blockedBy) {
  return { ok: false, httpStatus: 0, wasDisabled: blockedBy === 'flag', blockedBy, error };
}

function makeLogger(replyDbId) {
  return function log(level, gate, message) {
    console.log(`[reddit/posting] [${level}] [${gate}] reply=${replyDbId} — ${message}`);
  };
}

async function saveAttempt(db, data) {
  try {
    await db.redditPostingAttempt.create({
      data: {
        replyId:    data.replyId,
        threadId:   data.threadId,
        attempted:  data.attempted  ?? false,
        ok:         data.ok         ?? false,
        httpStatus: data.httpStatus ?? 0,
        commentId:  data.commentId  ?? null,
        commentUrl: data.commentUrl ?? null,
        blockedBy:  data.blockedBy  ?? null,
        error:      data.error      ?? null,
        dryRun:     data.dryRun     ?? false,
        decidedBy:  data.decidedBy  ?? null,
      },
    });
  } catch (err) {
    console.error('[reddit/posting] saveAttempt failed (non-fatal):', err.message);
  }
}

module.exports = { postApprovedReply };
