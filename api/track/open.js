/**
 * /api/track/open
 *
 * GET ?eid={seqId}~{contactId}~{touchStep}
 *   → Records the open in Postgres, returns a 1×1 transparent GIF
 *
 * GET ?list=1&seqId={seqId}
 *   → Returns all EmailOpen records for that sequence (used by "Check Opens" button)
 */

import { prisma } from "../_lib/prisma.js";

// 1×1 transparent GIF (35 bytes)
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // ── LIST: return opens for a sequence ───────────────────────────────────────
  if (req.query.list) {
    const { seqId } = req.query;
    if (!seqId) return res.status(400).json({ error: "seqId required" });
    try {
      const opens = await prisma.emailOpen.findMany({
        where: { seqId },
        orderBy: { openedAt: "desc" },
        select: { contactId: true, touchStep: true, openedAt: true },
      });
      return res.json({ opens });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PIXEL: record open, return GIF ──────────────────────────────────────────
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Content-Length", PIXEL.length);

  const { eid } = req.query;
  if (eid) {
    const [seqId, contactId, stepStr] = eid.split("~");
    const touchStep = parseInt(stepStr) || 0;
    if (seqId && contactId) {
      try {
        await prisma.emailOpen.create({ data: { eid, seqId, contactId, touchStep } });
      } catch { /* ignore duplicates or DB errors — pixel still returns */ }
    }
  }

  return res.end(PIXEL);
}
