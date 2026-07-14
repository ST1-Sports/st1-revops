/**
 * /api/cron/status — Campaign send status and global pause control
 *
 * GET  → returns current queue, last run, and global pause state
 * POST { action: "pause" }  → pauses all sending (sets state.globalPause=true in DB)
 * POST { action: "resume" } → resumes sending (sets state.globalPause=false)
 * POST { action: "status" } → same as GET
 */

import { setCors } from '../_lib/cors.js';
import { prisma } from '../_lib/prisma.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.method === 'POST' ? (req.body?.action || 'status') : 'status';

  try {
    const row = await prisma.setting.findUnique({ where: { key: 'app_state' } });
    if (!row?.value) {
      return res.json({ ok: true, globalPause: false, lastCronRun: null, queue: [], todaySent: 0 });
    }

    const state = row.value;

    if (action === 'pause') {
      const updated = { ...state, globalPause: true };
      await prisma.setting.upsert({
        where: { key: 'app_state' },
        update: { value: updated },
        create: { key: 'app_state', value: updated },
      });
      return res.json({ ok: true, globalPause: true });
    }

    if (action === 'resume') {
      const updated = { ...state, globalPause: false };
      await prisma.setting.upsert({
        where: { key: 'app_state' },
        update: { value: updated },
        create: { key: 'app_state', value: updated },
      });
      return res.json({ ok: true, globalPause: false });
    }

    // Build queue summary — campaigns with pending scheduled batches
    const campaigns = state.campaigns || [];
    const now = Date.now();
    const todayStr = new Date().toISOString().slice(0, 10);

    const queue = [];
    let todaySent = 0;

    for (const camp of campaigns) {
      const pending = Object.entries(camp.scheduledBatches || {})
        .map(([bk, info]) => ({ bk, ...info }))
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

      // Count today's sent from sentBatches
      for (const [, sb] of Object.entries(camp.sentBatches || {})) {
        if (sb.sentAt && sb.sentAt.startsWith(todayStr)) todaySent += (sb.sent || 0);
      }

      if (pending.length === 0) continue;

      queue.push({
        campaignId: camp.id,
        campaignName: camp.name || camp.id,
        batches: pending.map(b => ({
          batchKey: b.bk,
          touchIdx: b.touchIdx,
          contactCount: (b.contactIds || []).length,
          scheduledAt: b.scheduledAt,
          overdue: new Date(b.scheduledAt).getTime() <= now,
        })),
      });
    }

    // Enrollment summary across all campaigns
    const enrollSummary = { active: 0, done: 0, interested: 0, total: 0 };
    for (const camp of campaigns) {
      for (const e of (camp.enrollments || [])) {
        enrollSummary.total++;
        if (e.status === 'active') enrollSummary.active++;
        else if (e.status === 'done') enrollSummary.done++;
        else if (e.status === 'interested') enrollSummary.interested++;
      }
    }

    return res.json({
      ok: true,
      globalPause: state.globalPause === true,
      lastCronRun: state.lastCronRun || null,
      queue,
      todaySent,
      enrollSummary,
      activeCampaigns: campaigns.filter(c => c.status === 'active').length,
    });

  } catch (err) {
    console.error('[cron/status]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
