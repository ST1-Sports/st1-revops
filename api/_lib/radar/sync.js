/**
 * Gmail sync for Follow-Up Radar: 120-day backfill + history API incremental.
 * Always fetches the FULL thread. Hard-filters before any LLM call.
 */
import { prisma } from '../prisma.js';
import { classifyThread } from './classify.js';
import {
  campaignSubjectKeys,
  emailedWithinBusinessDays,
  hardFilter,
  parseEmail,
  WARMUP_LABEL_RE,
} from './filters.js';
import {
  getFullThread,
  listHistory,
  listLabels,
  listSentThreadIds,
  profile,
  refreshAccessToken,
  runPool,
  threadHash,
  ymdDaysAgo,
} from './gmail.js';
import { matchContactDeal } from './matchDeals.js';
import { seedRadarConfig, vendorDomainSet } from './seed.js';
import { createRadarDraft } from './drafts.js';

const FETCH_CONCURRENCY = 10;
const CLASSIFY_CONCURRENCY = 4;
const LIST_PAGE = 100;
const MAX_THREADS_PER_RUN = Number(process.env.RADAR_SYNC_MAX_THREADS || 2200);

function gmailLink(threadId) {
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
}

function sentEventsFromThreads(threads, ownerEmail) {
  const owner = String(ownerEmail || '').toLowerCase();
  const events = [];
  for (const t of threads) {
    for (const m of t.messages || []) {
      const from = parseEmail(m.from).email;
      if (from !== owner) continue;
      events.push({
        subject: m.subject || t.subject,
        recipients: [...(m.to || []), ...(m.cc || [])].filter(e => e && e !== owner),
        at: m.internalDate || Date.now(),
      });
    }
  }
  return events;
}

async function attachLabelNames(thread, labelMap) {
  thread.labelNames = (thread.labelIds || []).map(id => labelMap.get(id) || id);
  return thread;
}

async function upsertSnapshot(connection, thread, filterReason) {
  const participants = [];
  const seen = new Set();
  for (const m of thread.messages || []) {
    for (const raw of [m.from, ...(m.to || []), ...(m.cc || [])]) {
      const p = typeof raw === 'string' && raw.includes('@') && !raw.includes(' ')
        ? { email: raw.toLowerCase(), name: '' }
        : parseEmail(raw);
      if (!p.email || seen.has(p.email)) continue;
      seen.add(p.email);
      participants.push(p);
    }
  }
  await prisma.threadSnapshot.upsert({
    where: { userId_threadId: { userId: connection.userId, threadId: thread.id } },
    update: {
      connectionId: connection.id,
      subject: thread.subject || '',
      participants,
      lastMessageAt: thread.lastMessageAt,
      lastMessageId: thread.lastMessageId,
      hash: threadHash(thread),
      filterReason,
    },
    create: {
      connectionId: connection.id,
      userId: connection.userId,
      threadId: thread.id,
      subject: thread.subject || '',
      participants,
      lastMessageAt: thread.lastMessageAt,
      lastMessageId: thread.lastMessageId,
      hash: threadHash(thread),
      filterReason,
    },
  });
}

async function upsertFollowUp(connection, thread, classification) {
  const match = await matchContactDeal({
    contactEmail: classification.contactEmail,
    organization: classification.organization,
  });
  const radarBuckets = classification.bucket === 'owes_reply' || classification.bucket === 'awaiting_them';
  const data = {
    connectionId: connection.id,
    bucket: classification.bucket,
    status: radarBuckets ? 'open' : classification.bucket,
    contactName: classification.contactName,
    contactEmail: classification.contactEmail,
    organization: classification.organization,
    orgType: classification.orgType,
    intentScore: classification.intentScore,
    dealContext: classification.dealContext,
    openCommitments: classification.openCommitments,
    lastTouchAt: classification.lastTouchAt,
    lastTouchBy: classification.lastTouchBy,
    daysSinceLastTouch: classification.daysSinceLastTouch,
    suggestedNextStep: classification.suggestedNextStep,
    dealId: match.dealId,
    dealStage: match.dealStage,
    gmailPermalink: gmailLink(thread.id),
    source: 'sync',
  };
  return prisma.followUpItem.upsert({
    where: { userId_threadId: { userId: connection.userId, threadId: thread.id } },
    update: data,
    create: { userId: connection.userId, threadId: thread.id, ...data },
  });
}

async function detectSentDrafts(connection, accessToken, touchedThreadIds) {
  const openLogs = await prisma.draftLog.findMany({
    where: {
      sentDetectedAt: null,
      gmailDraftId: { not: null },
      followUpItem: { userId: connection.userId },
    },
    include: { followUpItem: true },
    take: 80,
  });
  for (const log of openLogs) {
    if (touchedThreadIds && !touchedThreadIds.has(log.followUpItem.threadId)) continue;
    try {
      const { getDraft } = await import('./gmail.js');
      await getDraft(accessToken, log.gmailDraftId);
    } catch (err) {
      if (err.status !== 404) continue;
      await prisma.draftLog.update({
        where: { id: log.id },
        data: { sentDetectedAt: new Date() },
      });
      const item = log.followUpItem;
      if (item.bucket === 'owes_reply') {
        await prisma.followUpItem.update({
          where: { id: item.id },
          data: {
            bucket: 'awaiting_them',
            lastTouchBy: 'us',
            lastTouchAt: new Date(),
            daysSinceLastTouch: 0,
            status: 'open',
          },
        });
      }
    }
  }
}

async function fetchThreadIds(accessToken, { afterYmd, startPageToken, max }) {
  const ids = [];
  let pageToken = startPageToken || undefined;
  let historyId = null;
  while (ids.length < max) {
    const page = await listSentThreadIds(accessToken, {
      afterYmd,
      pageToken,
      maxResults: LIST_PAGE,
    });
    historyId = page.historyId || historyId;
    for (const t of page.threads || []) {
      if (t.id) ids.push(t.id);
      if (ids.length >= max) break;
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return { ids, nextPageToken: pageToken || null, historyId };
}

async function historyThreadIds(accessToken, startHistoryId) {
  const ids = new Set();
  let pageToken;
  let latest = startHistoryId;
  for (let i = 0; i < 10; i++) {
    const page = await listHistory(accessToken, startHistoryId, pageToken);
    latest = page.historyId || latest;
    for (const h of page.history || []) {
      for (const added of h.messagesAdded || []) {
        if (added.message?.threadId) ids.add(added.message.threadId);
      }
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return { ids: [...ids], historyId: latest };
}

export async function syncConnection(connectionId, { mode } = {}) {
  await seedRadarConfig();
  const connection = await prisma.inboxConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.status === 'disconnected') {
    return { ok: false, error: 'not_connected' };
  }

  await prisma.inboxConnection.update({
    where: { id: connection.id },
    data: { status: 'syncing', lastError: null },
  });

  const stats = {
    listed: 0,
    fetched: 0,
    filtered: 0,
    classified: 0,
    radar: 0,
    drafted: 0,
    skippedDraft: 0,
    errors: [],
  };

  try {
    const accessToken = await refreshAccessToken(connection.encryptedRefreshToken);
    const me = await profile(accessToken);
    // Owner detection and draft From: use the mailbox's real address from the first run.
    const ownerEmail = String(me.emailAddress || connection.email || '').toLowerCase();
    const labels = await listLabels(accessToken);
    const labelMap = new Map(labels.map(l => [l.id, l.name]));
    const vendors = await vendorDomainSet();
    const days = connection.backfillDays || 120;
    const afterYmd = ymdDaysAgo(days);

    // An unfinished backfill (saved page cursor) is completed before switching to incremental.
    const backfillPending = Boolean(connection.syncCursor?.pageToken);
    const useIncremental =
      (mode || (connection.lastSyncAt && connection.historyId && !backfillPending ? 'incremental' : 'backfill')) ===
      'incremental';
    let threadIds = [];
    let nextHistoryId = me.historyId || connection.historyId;
    let nextPageToken = null;

    if (useIncremental && connection.historyId) {
      try {
        const hist = await historyThreadIds(accessToken, connection.historyId);
        threadIds = hist.ids;
        nextHistoryId = hist.historyId || nextHistoryId;
      } catch (err) {
        if (err.code !== 'history_expired') throw err;
        const listed = await fetchThreadIds(accessToken, { afterYmd, max: MAX_THREADS_PER_RUN });
        threadIds = listed.ids;
        nextPageToken = listed.nextPageToken;
        nextHistoryId = listed.historyId || nextHistoryId;
      }
    } else {
      const cursor = connection.syncCursor || {};
      const listed = await fetchThreadIds(accessToken, {
        afterYmd,
        startPageToken: cursor.pageToken,
        max: MAX_THREADS_PER_RUN,
      });
      threadIds = listed.ids;
      nextPageToken = listed.nextPageToken;
      nextHistoryId = listed.historyId || nextHistoryId;
    }

    stats.listed = threadIds.length;
    const uniqueIds = [...new Set(threadIds)];

    const parsed = await runPool(uniqueIds, FETCH_CONCURRENCY, async (id) => {
      try {
        const t = await getFullThread(accessToken, id);
        await attachLabelNames(t, labelMap);
        stats.fetched++;
        return t;
      } catch (err) {
        stats.errors.push(`${id}: ${err.message}`);
        return null;
      }
    });
    const threads = parsed.filter(Boolean);

    // Warmup labels: if Gmail has a dedicated warmup label, treat those ids as warmup too.
    for (const t of threads) {
      if ((t.labelIds || []).some(id => WARMUP_LABEL_RE.test(labelMap.get(id) || ''))) {
        t.labelNames = t.labelNames || [];
        if (!t.labelNames.some(n => WARMUP_LABEL_RE.test(n))) t.labelNames.push('warmup');
      }
    }

    const recentSnaps = await prisma.threadSnapshot.findMany({
      where: { userId: connection.userId, lastMessageAt: { gte: new Date(Date.now() - 3 * 86400000) } },
      take: 500,
    });
    const snapEvents = recentSnaps.map(snap => ({
      subject: snap.subject,
      recipients: (Array.isArray(snap.participants) ? snap.participants : []).map(p => p.email).filter(e => e && e !== ownerEmail),
      at: snap.lastMessageAt || Date.now(),
    }));
    const campaign = campaignSubjectKeys([
      ...sentEventsFromThreads(threads, ownerEmail),
      ...snapEvents,
    ]);
    const toClassify = [];

    for (const t of threads) {
      const existing = await prisma.threadSnapshot.findUnique({
        where: { userId_threadId: { userId: connection.userId, threadId: t.id } },
      }).catch(() => null);
      const hash = threadHash(t);
      const filt = hardFilter(t, {
        ownerEmail,
        vendorDomains: vendors,
        campaignSubjects: campaign,
      });
      await upsertSnapshot(connection, t, filt.exclude ? filt.reason : null);
      if (filt.exclude) {
        stats.filtered++;
        continue;
      }
      if (existing && existing.hash === hash && existing.filterReason == null) {
        const item = await prisma.followUpItem.findUnique({
          where: { userId_threadId: { userId: connection.userId, threadId: t.id } },
        });
        if (item) continue;
      }
      toClassify.push(t);
    }

    const classifiedItems = [];
    await runPool(toClassify, CLASSIFY_CONCURRENCY, async (t) => {
      try {
        const cls = await classifyThread(t, { ownerEmail });
        stats.classified++;
        const item = await upsertFollowUp(connection, t, cls);
        if (item.bucket === 'owes_reply' || item.bucket === 'awaiting_them') {
          stats.radar++;
          classifiedItems.push({ item, thread: t });
        }
      } catch (err) {
        stats.errors.push(`classify ${t.id}: ${err.message}`);
      }
    });

    // Only recent conversations get an automatic draft; a first backfill must not fill Drafts
    // with replies to stale threads. Older ones can still be drafted on request.
    const maxDraftAgeMs = Math.max(1, Number(process.env.RADAR_AUTO_DRAFT_MAX_AGE_DAYS) || 14) * 86400000;
    for (const { item, thread } of classifiedItems) {
      if (item.bucket !== 'owes_reply') continue;
      if (!item.lastTouchAt || Date.now() - new Date(item.lastTouchAt).getTime() > maxDraftAgeMs) {
        stats.skippedDraft++;
        continue;
      }
      if (emailedWithinBusinessDays(item.lastTouchAt, item.lastTouchBy, 3)) {
        stats.skippedDraft++;
        continue;
      }
      const existingDraft = await prisma.draftLog.findFirst({
        where: { followUpItemId: item.id, sentDetectedAt: null },
      });
      if (existingDraft) continue;
      try {
        const result = await createRadarDraft({
          connection: { ...connection, email: ownerEmail || connection.email },
          item,
          thread,
          skipRecentCheck: true,
        });
        if (result.skipped) stats.skippedDraft++;
        else stats.drafted++;
      } catch (err) {
        stats.errors.push(`draft ${item.id}: ${err.message}`);
      }
    }

    await detectSentDrafts(connection, accessToken, new Set(uniqueIds));

    await prisma.inboxConnection.update({
      where: { id: connection.id },
      data: {
        status: 'active',
        lastSyncAt: new Date(),
        historyId: nextHistoryId ? String(nextHistoryId) : connection.historyId,
        email: ownerEmail || connection.email,
        syncCursor: nextPageToken ? { pageToken: nextPageToken } : null,
        lastError: stats.errors.length ? stats.errors.slice(0, 8).join('; ') : null,
      },
    });

    return { ok: true, stats, remaining: Boolean(nextPageToken) };
  } catch (err) {
    await prisma.inboxConnection.update({
      where: { id: connection.id },
      data: { status: 'error', lastError: err.message },
    }).catch(() => {});
    return { ok: false, error: err.message, stats };
  }
}

export async function syncAllConnections() {
  await seedRadarConfig();
  const conns = await prisma.inboxConnection.findMany({
    where: { status: { in: ['active', 'error', 'syncing'] } },
    // Never-synced (new) connections first, so a long list cannot starve them.
    orderBy: { lastSyncAt: { sort: 'asc', nulls: 'first' } },
  });
  const results = [];
  for (const c of conns) {
    results.push({ connectionId: c.id, userId: c.userId, ...(await syncConnection(c.id)) });
  }
  return { ok: true, count: results.length, results };
}
