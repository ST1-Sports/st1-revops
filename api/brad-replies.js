/**
 * /api/brad-replies
 *
 * GET  — return recent positive replies Brad received (action=reply_intent)
 *         sorted newest-first, optionally filtered to outcome=pending
 * POST { id } with header x-action: mark-handled — mark a reply as handled
 */
import { setCors } from './_lib/cors.js'
import { prisma }  from './_lib/prisma.js'

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    try {
      const rows = await prisma.agentInteraction.findMany({
        where: { agentId: 'brad', action: 'reply_intent' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      return res.json({ replies: rows })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  if (req.method === 'POST' && req.headers['x-action'] === 'mark-handled') {
    const { id } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    try {
      await prisma.agentInteraction.update({
        where: { id },
        data:  { outcome: 'handled', outcomeAt: new Date() },
      })
      return res.json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
