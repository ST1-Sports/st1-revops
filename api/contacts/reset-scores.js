/**
 * POST /api/contacts/reset-scores
 *
 * One-time cleanup after the auto-reply scoring bug (checkReplies in
 * RevOps.jsx credited out-of-office/bounce/unsubscribe messages as real
 * "replied" intent — fixed separately, but that fix only stops new false
 * credits; it can't retroactively fix a score already inflated by it).
 * Zeroes every SalesContact's score in one shot so the intent threshold
 * means what it's supposed to again, going forward.
 *
 * Body: {} — no params, resets every row.
 * Returns: { ok, reset }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const result = await prisma.salesContact.updateMany({ where: { score: { not: 0 } }, data: { score: 0 } })
  return res.json({ ok: true, reset: result.count })
}
