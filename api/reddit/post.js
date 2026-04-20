/**
 * Reddit Engagement Module — Reddit posting service.
 *
 * THIS SERVICE IS DISABLED BY DEFAULT.
 *
 * Posting is gated behind two independent checks:
 *   1. REDDIT_POSTING_ENABLED env var must be exactly "true"
 *   2. The RedditReply record must have approvedAt set (human approval recorded)
 *
 * If either check fails, the function returns immediately with wasDisabled=true
 * and no network call is made to Reddit.
 *
 * When enabled, this service:
 *   1. Validates the approval record in the DB
 *   2. Calls reddit-client.postComment
 *   3. Logs the post action to RedditRateLog
 *   4. Updates RedditReply with the comment ID and postedAt timestamp
 *   5. Advances RedditThread status to POSTED
 *
 * One reply per thread is enforced: if the thread already has a postedAt reply,
 * the service refuses to post again.
 */

const { postComment }     = require('./reddit-client');
const { logPostAction }   = require('./guardrails');
const { checkContent }    = require('./content-check');
const { PrismaClient }    = require('@prisma/client');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Attempt to post an approved reply to Reddit.
 *
 * @param {string} replyDbId   - RedditReply.id (cuid)
 * @returns {Promise<import('./types').PostingResult>}
 */
async function postApprovedReply(replyDbId) {
  // Hard gate — check env flag first, before any DB work
  if (process.env.REDDIT_POSTING_ENABLED !== 'true') {
    return {
      ok:          false,
      httpStatus:  0,
      wasDisabled: true,
      error:       'Posting is disabled. Set REDDIT_POSTING_ENABLED=true to enable.',
    };
  }

  const db = getPrisma();

  const reply = await db.redditReply.findUnique({
    where:   { id: replyDbId },
    include: { thread: true },
  });

  if (!reply) {
    return { ok: false, httpStatus: 0, wasDisabled: false, error: `Reply not found: ${replyDbId}` };
  }

  // Approval guard — must have been explicitly approved in the UI
  if (!reply.approvedAt) {
    return {
      ok: false, httpStatus: 0, wasDisabled: false,
      error: 'Reply has not been approved. Approve it in the RevOps review UI first.',
    };
  }

  // Already posted guard
  if (reply.postedAt) {
    return {
      ok: false, httpStatus: 0, wasDisabled: false,
      error: `Reply already posted at ${reply.postedAt.toISOString()} (${reply.redditCommentId})`,
    };
  }

  // One-reply-per-thread guard — check if any other reply for this thread is already posted
  const existingPost = await db.redditReply.findFirst({
    where: { threadId: reply.threadId, postedAt: { not: null } },
  });
  if (existingPost) {
    return {
      ok: false, httpStatus: 0, wasDisabled: false,
      error: `Thread already has a posted reply (${existingPost.redditCommentId}). One reply per thread max.`,
    };
  }

  // Content guardrail — final Claude check before posting
  const guardrail = await checkContent(replyDbId);
  if (!guardrail.approved_for_post) {
    return {
      ok:          false,
      httpStatus:  0,
      wasDisabled: false,
      error:       `Content guardrail blocked posting: ${guardrail.block_reason}` +
                   (guardrail.edit_suggestion ? ` Suggestion: ${guardrail.edit_suggestion}` : ''),
    };
  }

  // Post to Reddit
  const result = await postComment(reply.thread.redditId, reply.content);

  if (result.ok) {
    await logPostAction();

    await db.redditReply.update({
      where: { id: replyDbId },
      data:  {
        postedAt:        new Date(),
        redditCommentId: result.commentId || null,
      },
    });

    await db.redditThread.update({
      where: { id: reply.threadId },
      data:  { status: 'POSTED' },
    });
  }

  return result;
}

module.exports = { postApprovedReply };
