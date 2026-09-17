/**
 * GET/POST /api/crm/account
 *
 * CRM Accounts must exist in two places so they survive refresh and stay
 * linked in Zoho: Prisma Account (local source of truth for the list) and
 * Zoho CRM Accounts (find-or-create). The Accounts tab used to only derive
 * rows from contacts, so "+ Add" with a school name never produced an
 * account that could be opened or uploaded onto.
 *
 * GET  → { ok, accounts: [{ id, name, city, state, website, zohoAccountId }] }
 * POST { name, city?, state?, website? }
 *    → { ok, account, zohoAccountId, zohoCreated, zohoError? }
 */
import { prisma } from '../_lib/prisma.js'
import { setCors } from '../_lib/cors.js'
import { getZohoToken } from '../_lib/zoho-token.js'
import { zohoCrmHeaders } from '../_lib/zohoCrm.js'
import { findOrCreateZohoAccount } from '../_lib/zohoAccount.js'
import { accountDedupKey } from '../_lib/accountUtils.js'
import { mapAccountRow, websiteToDomain } from '../_lib/crmAccount.js'

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    try {
      const rows = await prisma.account.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 3000,
        select: {
          id: true,
          name: true,
          normalizedName: true,
          city: true,
          state: true,
          domain: true,
          zohoAccountId: true,
          metadata: true,
        },
      })
      return res.json({ ok: true, accounts: rows.map(mapAccountRow) })
    } catch (err) {
      console.error('[crm/account GET]', err.message)
      return res.status(500).json({ error: err.message })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' })

  const { name, city, state, website } = req.body || {}
  const trimmed = String(name || '').trim()
  if (!trimmed) return res.status(400).json({ error: 'name required' })

  const cityT = String(city || '').trim() || null
  const stateT = String(state || '').trim() || null
  const websiteT = String(website || '').trim() || null
  const domain = websiteToDomain(websiteT)
  const normalizedName = accountDedupKey(trimmed, stateT)
  if (!normalizedName) return res.status(400).json({ error: 'name required' })

  let zohoAccountId = null
  let zohoCreated = false
  let zohoError = null
  try {
    const token = await getZohoToken()
    const zoho = await findOrCreateZohoAccount(
      { name: trimmed, city: cityT, state: stateT, website: websiteT },
      zohoCrmHeaders(token),
    )
    zohoAccountId = zoho.id || null
    zohoCreated = !!zoho.created
  } catch (err) {
    zohoError = err.message
  }

  try {
    const metadata = websiteT ? { website: websiteT } : undefined
    const row = await prisma.account.upsert({
      where: { normalizedName },
      create: {
        name: trimmed,
        normalizedName,
        city: cityT,
        state: stateT,
        domain,
        orgType: 'school',
        zohoAccountId,
        metadata: metadata || {},
      },
      update: {
        name: trimmed,
        ...(cityT ? { city: cityT } : {}),
        ...(stateT ? { state: stateT } : {}),
        ...(domain ? { domain } : {}),
        ...(zohoAccountId ? { zohoAccountId } : {}),
        ...(metadata ? { metadata } : {}),
      },
    })
    return res.json({
      ok: true,
      account: mapAccountRow(row),
      zohoAccountId: row.zohoAccountId || zohoAccountId,
      zohoCreated,
      zohoError,
    })
  } catch (err) {
    console.error('[crm/account POST]', err.message)
    return res.status(500).json({ error: err.message, zohoAccountId, zohoError })
  }
}
