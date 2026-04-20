/**
 * Reddit Engagement Module — analytics report service.
 *
 * Aggregates data from all Reddit module tables to answer four key questions:
 *   1. Which subreddits perform best?
 *   2. Which reply styles get approved most?
 *   3. Which threads are most often skipped?
 *   4. Which generated replies are blocked by guardrails?
 *
 * Aggregation is done in-memory after a findMany. At typical Reddit module
 * volumes (hundreds to low thousands of threads), this is faster and simpler
 * than raw SQL or complex Prisma groupBy on JSON fields.
 *
 * All queries are scoped to a configurable look-back window (default 90 days).
 */

const { PrismaClient } = require('@prisma/client');

let prisma;
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Generate the full analytics report.
 *
 * @param {Object} [opts]
 * @param {number} [opts.days=90]
 * @returns {Promise<Object>}
 */
async function generateReport(opts = {}) {
  const days  = Math.max(1, parseInt(opts.days || '90', 10));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const db    = getPrisma();

  const [threads, guardrailLogs, postAttempts] = await Promise.all([
    db.redditThread.findMany({
      where:  { ingestedAt: { gte: since } },
      select: {
        id: true, subreddit: true, status: true, evaluation: true, ingestedAt: true,
        replies: {
          select: { id: true, variant: true, approvedAt: true, rejectedAt: true, postedAt: true, upvotes: true },
        },
      },
    }),
    db.redditGuardrailLog.findMany({
      where:  { createdAt: { gte: since }, dryRun: false },
      select: { subreddit: true, approvedForReview: true, approvedForPost: true, finalRiskScore: true },
    }),
    db.redditPostingAttempt.findMany({
      where:  { createdAt: { gte: since }, dryRun: false },
      select: { ok: true, attempted: true, blockedBy: true },
    }),
  ]);

  // ── Funnel ─────────────────────────────────────────────────────────────────
  const funnel = {
    ingested:        threads.length,
    evaluated:       threads.filter(t => t.evaluation != null).length,
    repliesGenerated:threads.filter(t => t.replies.length > 0).length,
    slackNotified:   threads.filter(t => ['NOTIFIED', 'APPROVED', 'REJECTED', 'POSTED'].includes(t.status)).length,
    approved:        threads.filter(t => ['APPROVED', 'POSTED'].includes(t.status)).length,
    posted:          threads.filter(t => t.status === 'POSTED').length,
    rejected:        threads.filter(t => t.status === 'REJECTED').length,
    skipped:         threads.filter(t => t.status === 'SKIPPED').length,
  };

  // ── Subreddit performance ──────────────────────────────────────────────────
  const subMap = {};
  for (const t of threads) {
    if (!subMap[t.subreddit]) {
      subMap[t.subreddit] = { ingested: 0, evaluated: 0, approved: 0, posted: 0, rejected: 0, skipped: 0, fitScores: [], upvotes: [] };
    }
    const s = subMap[t.subreddit];
    s.ingested++;
    if (t.evaluation != null) s.evaluated++;
    if (['APPROVED', 'POSTED'].includes(t.status)) s.approved++;
    if (t.status === 'POSTED') s.posted++;
    if (t.status === 'REJECTED') s.rejected++;
    if (t.status === 'SKIPPED') s.skipped++;
    const fit = t.evaluation?.fit_score ?? t.evaluation?.fitScore ?? null;
    if (typeof fit === 'number') s.fitScores.push(fit);
    const posted = t.replies.find(r => r.postedAt && r.upvotes != null);
    if (posted) s.upvotes.push(posted.upvotes);
  }

  const subreddits = Object.entries(subMap)
    .map(([subreddit, s]) => ({
      subreddit,
      ingested:     s.ingested,
      evaluated:    s.evaluated,
      approved:     s.approved,
      posted:       s.posted,
      rejected:     s.rejected,
      skipped:      s.skipped,
      approvalRate: s.evaluated > 0 ? +(s.approved / s.evaluated).toFixed(3) : 0,
      postRate:     s.ingested  > 0 ? +(s.posted   / s.ingested).toFixed(3)  : 0,
      avgFitScore:  s.fitScores.length ? +(_avg(s.fitScores).toFixed(1)) : null,
      avgUpvotes:   s.upvotes.length   ? +(_avg(s.upvotes).toFixed(1))   : null,
    }))
    .sort((a, b) => b.postRate - a.postRate);

  // ── Reply variant approval rates ───────────────────────────────────────────
  const v = { 1: { generated: 0, approved: 0 }, 2: { generated: 0, approved: 0 } };
  for (const t of threads) {
    for (const r of t.replies) {
      const slot = r.variant === 1 ? 1 : 2;
      v[slot].generated++;
      if (r.approvedAt) v[slot].approved++;
    }
  }
  const replyVariants = {
    primary: { generated: v[1].generated, approved: v[1].approved, approvalRate: v[1].generated > 0 ? +(v[1].approved / v[1].generated).toFixed(3) : 0 },
    safer:   { generated: v[2].generated, approved: v[2].approved, approvalRate: v[2].generated > 0 ? +(v[2].approved / v[2].generated).toFixed(3) : 0 },
  };

  // ── Skip breakdown by intent / audience ────────────────────────────────────
  const intentCounts = {}, audienceCounts = {};
  for (const t of threads.filter(t => t.status === 'SKIPPED')) {
    const ev  = t.evaluation || {};
    const intent   = ev.intent_type   || ev.intentType   || 'unknown';
    const audience = ev.audience_type || ev.audienceType || 'unknown';
    intentCounts[intent]     = (intentCounts[intent]   || 0) + 1;
    audienceCounts[audience] = (audienceCounts[audience] || 0) + 1;
  }
  const skipByIntent   = Object.entries(intentCounts).map(([intent, count]) => ({ intent, count })).sort((a, b) => b.count - a.count);
  const skipByAudience = Object.entries(audienceCounts).map(([audience, count]) => ({ audience, count })).sort((a, b) => b.count - a.count);

  // ── Guardrail analysis ─────────────────────────────────────────────────────
  const guardrailSummary = {
    total:             guardrailLogs.length,
    approvedForPost:   guardrailLogs.filter(g => g.approvedForPost).length,
    blockedForPost:    guardrailLogs.filter(g => !g.approvedForPost).length,
    approvedForReview: guardrailLogs.filter(g => g.approvedForReview).length,
    blockedForReview:  guardrailLogs.filter(g => !g.approvedForReview).length,
    avgRiskScore:      guardrailLogs.length ? +(_avg(guardrailLogs.map(g => g.finalRiskScore)).toFixed(1)) : null,
  };

  const subGuardrailMap = {};
  for (const g of guardrailLogs) {
    if (!subGuardrailMap[g.subreddit]) subGuardrailMap[g.subreddit] = { total: 0, blocked: 0 };
    subGuardrailMap[g.subreddit].total++;
    if (!g.approvedForPost) subGuardrailMap[g.subreddit].blocked++;
  }
  const guardrailSubreddits = Object.entries(subGuardrailMap)
    .map(([subreddit, s]) => ({ subreddit, total: s.total, blocked: s.blocked, blockRate: +(s.blocked / s.total).toFixed(3) }))
    .sort((a, b) => b.blockRate - a.blockRate);

  // ── Posting gate blocks ────────────────────────────────────────────────────
  const GATE_LABELS = {
    flag: 'Feature flag disabled', not_approved: 'Not approved by human',
    already_posted: 'Already posted', one_per_thread: 'One reply per thread',
    mute_subreddit: 'Subreddit muted', mute_keyword: 'Keyword muted',
    daily_cap: 'Daily post cap hit', cooldown: 'Post cooldown active',
    similarity: 'Too similar to recent post', guardrail: 'Content guardrail blocked',
    guardrail_error: 'Guardrail check errored', api_error: 'Reddit API error',
  };
  const gateCounts = {};
  for (const a of postAttempts) {
    if (a.blockedBy) gateCounts[a.blockedBy] = (gateCounts[a.blockedBy] || 0) + 1;
  }
  const gateBlocks = Object.entries(gateCounts)
    .map(([gate, count]) => ({ gate, label: GATE_LABELS[gate] || gate, count }))
    .sort((a, b) => b.count - a.count);

  const postingSuccess = {
    totalAttempts:   postAttempts.filter(a => a.attempted).length,
    succeeded:       postAttempts.filter(a => a.ok).length,
    failed:          postAttempts.filter(a => a.attempted && !a.ok).length,
    blockedByGates:  postAttempts.filter(a => !a.attempted && a.blockedBy).length,
  };

  return {
    period:              { days, from: since.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) },
    funnel,
    subreddits,
    replyVariants,
    skipByIntent,
    skipByAudience,
    guardrailSummary,
    guardrailSubreddits,
    gateBlocks,
    postingSuccess,
  };
}

function _avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

module.exports = { generateReport };
