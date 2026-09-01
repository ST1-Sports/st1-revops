/**
 * Pull later-list people off Ready when an earlier Active/Approved
 * upload already owns their email. Writes the holds to OutreachBatch.leads.
 */
import { PrismaClient } from '@prisma/client';
import { applyFirstUploadHolds, claimedEmails } from '../api/_lib/outreachSent.js';

const prisma = new PrismaClient();

function countsFrom(leads) {
  const sendable = leads.filter(l => l?.sendable && l?.email && !l.heldForEarlier && !l.bounced);
  return {
    totalCount: leads.length,
    sendableCount: sendable.length,
    touchCount: sendable.reduce((a, l) => a + (l.touches || []).length, 0),
  };
}

const batches = await prisma.outreachBatch.findMany({ orderBy: { createdAt: 'asc' } });
const claims = claimedEmails(batches);
const summary = [];

for (const batch of batches) {
  const { leads, changed } = applyFirstUploadHolds(batch.leads, batch.id, claims);
  if (!changed) {
    summary.push({ id: batch.id, name: batch.name, changed: 0, held: leads.filter(l => l.heldForEarlier).length, sendable: countsFrom(leads).sendableCount });
    continue;
  }
  const counts = countsFrom(leads);
  await prisma.outreachBatch.update({
    where: { id: batch.id },
    data: { leads, ...counts },
  });
  const held = leads.filter(l => l.heldForEarlier);
  summary.push({
    id: batch.id,
    name: batch.name,
    changed,
    held: held.length,
    sendable: counts.sendableCount,
    emails: held.map(l => l.email),
  });
}

console.log(JSON.stringify({ claims: claims.size, batches: summary }, null, 2));
await prisma.$disconnect();
