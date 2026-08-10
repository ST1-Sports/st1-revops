/**
 * Reddit Engagement Module — engagement metrics service.
 *
 * Polls Reddit for upvote counts and moderation status on posted comments.
 * Triggered manually via the review UI (action="analytics") since Vercel Hobby
 * does not support scheduled cron jobs on serverless functions.
 *
 * Metrics stored back to RedditReply.upvotes on each poll.
 */

const { getCommentMetrics } = require('../reddit-client');
const { getPrisma } = require('./_prisma');


/**
 * Poll Reddit for engagement metrics on all posted replies and update DB.
 *
 * @param {boolean} [dryRun] - If true, return metrics without writing to DB
 * @returns {Promise<import('../types').AnalyticsRecord[]>}
 */
async function refreshAnalytics(dryRun = false) {
  const db = getPrisma();

  const postedReplies = await db.redditReply.findMany({
    where:  { postedAt: { not: null }, redditCommentId: { not: null } },
    select: { id: true, redditCommentId: true },
  });

  const records = [];

  for (const reply of postedReplies) {
    let metrics;
    try {
      metrics = await getCommentMetrics(reply.redditCommentId);
    } catch (err) {
      console.error(`[reddit/analytics] getCommentMetrics failed for ${reply.redditCommentId}:`, err.message);
      continue;
    }

    const record = {
      replyId:         reply.id,
      redditCommentId: reply.redditCommentId,
      upvotes:         metrics.score,
      score:           metrics.score,
      removed:         metrics.removed,
      fetchedAt:       new Date().toISOString(),
    };

    if (!dryRun) {
      await db.redditReply.update({
        where: { id: reply.id },
        data:  { upvotes: metrics.score },
      });
    }

    records.push(record);
  }

  return records;
}

/**
 * Fetch the current analytics snapshot for a single reply.
 *
 * @param {string} replyDbId
 * @returns {Promise<import('../types').AnalyticsRecord | null>}
 */
async function getReplyAnalytics(replyDbId) {
  const db = getPrisma();

  const reply = await db.redditReply.findUnique({
    where:  { id: replyDbId },
    select: { id: true, redditCommentId: true, upvotes: true, postedAt: true },
  });

  if (!reply || !reply.redditCommentId) return null;

  const metrics = await getCommentMetrics(reply.redditCommentId)
    .catch(() => ({ score: reply.upvotes ?? 0, removed: false }));

  return {
    replyId:         reply.id,
    redditCommentId: reply.redditCommentId,
    upvotes:         metrics.score,
    score:           metrics.score,
    removed:         metrics.removed,
    fetchedAt:       new Date().toISOString(),
  };
}

module.exports = { refreshAnalytics, getReplyAnalytics };
