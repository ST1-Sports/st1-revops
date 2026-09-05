/**
 * /api/brad-replies
 *
 * GET  — return recent positive replies Brad received (action=reply_intent)
 *         sorted newest-first, optionally filtered to outcome=pending
 * POST { id } with header x-action: mark-handled — mark a reply as handled
 */
import { setCors } from './_lib/cors.js'
import { prisma }  from './_lib/prisma.js'
import { notifyBradSlack, notifyBradEmail } from './_lib/brad-shared.js'
import { junkReplyFromStored, isBradFollowUpReply } from './_lib/junkReply.js'

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    try {
      const rows = await prisma.agentInteraction.findMany({
        where: { agentId: 'brad', action: 'reply_intent', outcome: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      const junkIds = rows.filter(r => junkReplyFromStored(r)).map(r => r.id)
      if (junkIds.length) {
        await prisma.agentInteraction.updateMany({
          where: { id: { in: junkIds } },
          data: { outcome: 'ignored_junk', outcomeAt: new Date() },
        }).catch(() => {})
      }
      return res.json({ replies: rows.filter(isBradFollowUpReply) })
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

  if (req.method === 'POST' && req.headers['x-action'] === 'retry-notify') {
    const { id } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    try {
      const row = await prisma.agentInteraction.findUnique({ where: { id } })
      if (!row || row.agentId !== 'brad' || row.action !== 'reply_intent') {
        return res.status(404).json({ error: 'reply not found' })
      }
      if (junkReplyFromStored(row)) {
        await prisma.agentInteraction.update({
          where: { id },
          data: { outcome: 'ignored_junk', outcomeAt: new Date() },
        }).catch(() => {})
        return res.json({ ok: true, slack: 'skipped', email: 'skipped', ignored: 'junk' })
      }
      const inp = row.input || {}
      const out = row.output || {}
      const assigned = { name: out.assignedName || 'Matt Stone', email: out.assignedTo || 'matt@st1sports.com' }
      const slack = await notifyBradSlack(assigned, inp.contactName || inp.fromEmail, inp.fromEmail, inp.subject, inp.snippet)
      let email = { ok: out.email === 'sent' }
      if (out.email !== 'sent') {
        email = await notifyBradEmail(req.headers.host, assigned, inp.contactName || inp.fromEmail, inp.fromEmail, inp.subject, inp.snippet)
      }
      const output = {
        ...out,
        slack: slack?.ok ? 'sent' : (slack?.error || 'failed'),
        email: (email?.ok || out.email === 'sent') ? 'sent' : (email?.error || out.email || 'failed'),
      }
      await prisma.agentInteraction.update({ where: { id }, data: { output } })
      return res.json({ ok: !!(slack?.ok && (email?.ok || out.email === 'sent')), slack: output.slack, email: output.email })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
