/**
 * Brad positive-reply alerts create FollowUpItems instead of emailing reps.
 */
import { prisma } from '../prisma.js';
import { matchContactDeal } from './matchDeals.js';

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
      intentScore: Math.max(70, 0),
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

  return { ok: true, followUpItemId: item.id, userId, snippet: String(bodyText || '').slice(0, 200) };
}
