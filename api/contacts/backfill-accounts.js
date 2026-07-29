/**
 * POST /api/contacts/backfill-accounts
 *
 * One-time backfill: every existing SalesContact with a companyName but no
 * accountId gets linked to (or creates) an Account row, grouped by
 * normalizeAccountName so casing/whitespace variants of the same school
 * collapse into one Account instead of staying as loose duplicate strings.
 *
 * Body: { dryRun?: boolean } — default false (actually writes)
 * Returns: { accountsCreated, contactsLinked, dryRun }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { accountDedupKey } from '../_lib/accountUtils.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const dryRun = req.body?.dryRun === true

  const contacts = await prisma.salesContact.findMany({
    where: { accountId: null, companyName: { not: null } },
    select: { id: true, companyName: true, city: true, state: true },
  })

  const groups = new Map() // dedupKey (name+state) -> { name, city, state, contactIds: [] }
  for (const c of contacts) {
    const dedupKey = accountDedupKey(c.companyName, c.state)
    if (!dedupKey) continue
    if (!groups.has(dedupKey)) {
      groups.set(dedupKey, { name: c.companyName.trim(), city: c.city, state: c.state, contactIds: [] })
    }
    const g = groups.get(dedupKey)
    if (!g.city && c.city) g.city = c.city
    g.contactIds.push(c.id)
  }

  if (dryRun) {
    return res.json({ accountsCreated: groups.size, contactsLinked: contacts.length, dryRun: true })
  }

  let accountsCreated = 0, contactsLinked = 0
  for (const [dedupKey, g] of groups) {
    const account = await prisma.account.upsert({
      where: { normalizedName: dedupKey },
      create: { name: g.name, normalizedName: dedupKey, city: g.city || null, state: g.state || null },
      update: {},
    })
    accountsCreated++
    const result = await prisma.salesContact.updateMany({
      where: { id: { in: g.contactIds } },
      data: { accountId: account.id },
    })
    contactsLinked += result.count
  }

  return res.json({ accountsCreated, contactsLinked, dryRun: false })
}
