/**
 * Reddit Engagement Module — analytics service.
 *
 * Polls Reddit for engagement metrics on posted comments and writes an
 * AnalyticsRecord to the RedditReply row. Called on a manual trigger from
 * the review UI (no cron job — Vercel Hobby does not support cron on serverless).
 *
 * Metrics collected:
 *   - Current upvote count
 *   - Reddit score (net upvotes)
 *   - Whether the comment was removed by a moderator
 *
 * TODO (Phase 6): activate live polling. Current implementation returns a
 * clearly-labelled placeholder so the UI can render analytics stubs.
 */

const { getCommentMetrics } = require('./reddit-client');
const { PrismaClient }      = require('@prisma/client');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Poll Reddit for engagement metrics on all posted replies and update DB.
 *
 * @param {boolean} [dryRun] - If true, return metrics without writing to DB
 * @returns {Promise<import('./types').AnalyticsRecord[]>}
 */
async function refreshAnalytics(dryRun = false) {
  const db = getPrisma();

  // Only fetch metrics for replies that were actually posted
  const postedReplies = await db.redditReply.findMany({
    where: {
      postedAt:        { not: null },
      redditCommentId: { not: null },
    },
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
      upvotes:         metrics.score,    // Reddit score = upvotes - downvotes
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
 * Fetch the analytics snapshot for a single reply.
 *
 * @param {string} replyDbId - RedditReply.id
 * @returns {Promise<import('./types').AnalyticsRecord | null>}
 */
async function getReplyAnalytics(replyDbId) {
  const db = getPrisma();

  const reply = await db.redditReply.findUnique({
    where:  { id: replyDbId },
    select: { id: true, redditCommentId: true, upvotes: true, postedAt: true },
  });

  if (!reply || !reply.redditCommentId) return null;

  const metrics = await getCommentMetrics(reply.redditCommentId).catch(() => ({ score: reply.upvotes ?? 0, removed: false }));

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
