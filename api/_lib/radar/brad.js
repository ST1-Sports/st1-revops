/**
 * Brad positive-reply alerts become FollowUpItems for reps who connected Follow-Up Radar.
 * Reps without a Radar connection keep getting the email alert, and a Radar failure falls
 * back to email too, so a positive reply is never lost.
 */
import { prisma } from '../prisma.js';
import { matchContactDeal } from './matchDeals.js';
import { notifyBradEmail } from '../brad-shared.js';

/**
 * Never throws. Files the reply in the assigned rep's Radar when they have a live connection;
 * otherwise (or if that fails) sends the existing Brad email alert.
 */
export async function handOffBradReply(host, args, deps = {}) {
  const upsert = deps.upsert || upsertBradFollowUp;
  const email = deps.email || notifyBradEmail;
  let radar;
  try {
    radar = await upsert(args);
  } catch (error) {
    console.warn('[brad] radar follow-up failed:', error?.message || error);
    radar = { ok: false, error: 'radar_failed' };
  }
  if (radar.ok && radar.connected) return { ...radar, email: 'skipped' };
  const sent = await email(
    host,
    args.assigned,
    args.contactName,
    args.fromEmail,
    args.subject,
    args.bodyText,
  ).catch((error) => ({ ok: false, error: error?.message || 'email_failed' }));
  return { ...radar, email: sent?.ok ? 'sent' : sent?.error || 'failed' };
}

export async function upsertBradFollowUp({ assigned, fromEmail, contactName, subject, bodyText }) {
  const email = String(fromEmail || '').toLowerCase();
  if (!email) return { ok: false, error: 'no_email' };

  const assignedEmail = String(assigned?.email || '').toLowerCase();
  let connection = null;
  if (assignedEmail) {
    connection = await prisma.inboxConnection.findFirst({
      where: { email: assignedEmail, status: { not: 'disconnected' } },
    });
  }
  if (!connection && assignedEmail) {
    connection = await prisma.inboxConnection.findFirst({
      where: { userId: assignedEmail, status: { not: 'disconnected' } },
    });
  }

  const userId = connection?.userId || assignedEmail || assigned?.name || 'unassigned';
  const threadId = `brad:${email}:${String(subject || '').slice(0, 80)}`;
  const match = await matchContactDeal({ contactEmail: email, organization: '' });

  const item = await prisma.followUpItem.upsert({
    where: { userId_threadId: { userId, threadId } },
    update: {
      bucket: 'owes_reply',
      status: 'open',
      contactName: contactName || email,
      contactEmail: email,
      intentScore: 70,
      dealContext: `Brad positive reply: ${String(subject || '').slice(0, 180)}`,
      suggestedNextStep: 'Reply in-thread — they showed intent on a Brad outreach.',
      lastTouchAt: new Date(),
      lastTouchBy: 'them',
      daysSinceLastTouch: 0,
      source: 'brad',
      dealId: match.dealId,
      dealStage: match.dealStage,
    },
    create: {
      userId,
      threadId,
      connectionId: connection?.id || null,
      bucket: 'owes_reply',
      status: 'open',
      contactName: contactName || email,
      contactEmail: email,
      organization: '',
      orgType: 'other',
      intentScore: 80,
      dealContext: `Brad positive reply: ${String(subject || '').slice(0, 180)}`,
      openCommitments: [],
      suggestedNextStep: 'Reply in-thread — they showed intent on a Brad outreach.',
      lastTouchAt: new Date(),
      lastTouchBy: 'them',
      daysSinceLastTouch: 0,
      source: 'brad',
      dealId: match.dealId,
      dealStage: match.dealStage,
    },
  });

  return {
    ok: true,
    connected: Boolean(connection),
    followUpItemId: item.id,
    userId,
    snippet: String(bodyText || '').slice(0, 200),
  };
}
