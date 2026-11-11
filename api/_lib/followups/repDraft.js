/**
 * Review & send for follow-up drafts. Radar's automated code (sync, cron, draft writing) can
 * never send; this module is the only send path, and it is reached only from
 * POST /api/followups/send, which a signed-in rep triggers by clicking Send on their own item.
 */
import { prisma } from '../prisma.js';
import { refreshAccessToken, encodeRawMime } from '../radar/gmail.js';
import { extractPlaceholders } from '../radar/draftGuard.js';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmail(accessToken, path, { method = 'GET', body } = {}) {
  const r = await fetch(`${GMAIL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 404) return { notFound: true };
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || `Gmail ${r.status}`);
  return data;
}

const header = (headers, name) =>
  (headers || []).find(h => String(h.name).toLowerCase() === name.toLowerCase())?.value || '';

function plainBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data)
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  for (const part of payload.parts || []) {
    const text = plainBody(part);
    if (text) return text;
  }
  return '';
}

/** Pure: why this body must not be sent yet, or null. Exported for tests. */
export function sendBlocker(body) {
  const text = String(body || '').trim();
  if (!text) return 'The message is empty.';
  if (/\[REVIEW\b/i.test(text)) return 'Remove the [REVIEW …] note after checking the flagged details.';
  const placeholders = extractPlaceholders(text);
  if (placeholders.length) return `Fill in ${placeholders.slice(0, 3).join(', ')} before sending.`;
  return null;
}

/** The rep's own item, its latest unsent draft and their Gmail connection. */
export async function loadOwnDraft(repId, itemId) {
  const item = await prisma.followUpItem.findUnique({ where: { id: String(itemId || '') } });
  if (!item || item.userId !== repId) return { error: 'Follow-up not found', status: 404 };
  const log = await prisma.draftLog.findFirst({
    where: { followUpItemId: item.id, sentDetectedAt: null, gmailDraftId: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  if (!log) return { error: 'No draft yet — choose Write follow-up first.', status: 409, item };
  const connection = await prisma.inboxConnection.findUnique({
    where: { userId_provider: { userId: repId, provider: 'gmail' } },
  });
  if (!connection || connection.status === 'disconnected' || !connection.encryptedRefreshToken)
    return { error: 'Sign in with Google to connect your Gmail.', status: 409, item };
  const accessToken = await refreshAccessToken(connection.encryptedRefreshToken);
  const draft = await gmail(accessToken, `/drafts/${encodeURIComponent(log.gmailDraftId)}?format=full`);
  if (draft.notFound) {
    // Deleted or already sent from Gmail: the item stays, a new draft can be written.
    await prisma.draftLog.update({ where: { id: log.id }, data: { sentDetectedAt: new Date() } });
    return { error: 'That draft is no longer in Gmail (sent or deleted there). Write a new one.', status: 409, item };
  }
  const headers = draft.message?.payload?.headers || [];
  return {
    item,
    log,
    connection,
    accessToken,
    draft,
    view: {
      draftId: log.gmailDraftId,
      to: header(headers, 'To'),
      cc: header(headers, 'Cc'),
      subject: header(headers, 'Subject'),
      body: plainBody(draft.message?.payload) || log.body,
      needsInput: log.needsInput,
    },
  };
}

/** Saves the rep's edits into the Gmail draft and sends it in the same thread. */
export async function sendOwnDraft(loaded, body) {
  const { item, log, connection, accessToken, draft } = loaded;
  const headers = draft.message?.payload?.headers || [];
  const raw = encodeRawMime(
    {
      From: connection.email,
      To: header(headers, 'To'),
      Cc: header(headers, 'Cc'),
      Subject: header(headers, 'Subject'),
      'In-Reply-To': header(headers, 'In-Reply-To'),
      References: header(headers, 'References'),
    },
    body,
  );
  const threadId = draft.message?.threadId;
  const updated = await gmail(accessToken, `/drafts/${encodeURIComponent(log.gmailDraftId)}`, {
    method: 'PUT',
    body: { id: log.gmailDraftId, message: { raw, threadId } },
  });
  // Gmail removes a draft once it is sent, so a second click finds nothing and sends nothing.
  if (updated.notFound) throw Object.assign(new Error('This draft was already sent or deleted in Gmail.'), { status: 409 });
  const sent = await gmail(accessToken, '/drafts/send', { method: 'POST', body: { id: log.gmailDraftId } });
  if (sent.notFound) throw Object.assign(new Error('This draft was already sent or deleted in Gmail.'), { status: 409 });
  const now = new Date();
  await prisma.draftLog.update({ where: { id: log.id }, data: { sentDetectedAt: now, body } });
  await prisma.followUpItem.update({
    where: { id: item.id },
    data: {
      bucket: 'awaiting_them',
      lastTouchAt: now,
      lastTouchBy: 'us',
      daysSinceLastTouch: 0,
      needsInput: false,
    },
  });
  return { messageId: sent.id || null, threadId: sent.threadId || threadId || null };
}
