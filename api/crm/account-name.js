/**
 * POST /api/crm/account-name
 *
 * Resolves (or creates) the real Zoho CRM Account for a name, so renaming an
 * account in RevOps can link a Contact's Account_Name lookup to it directly
 * instead of leaving it as a bare, non-relational string.
 *
 * Body: { name, city?, state?, website? }
 * Returns: { ok, accountId, accountCreated }
 */
import { getZohoToken } from '../_lib/zoho-token.js'
import { setCors }      from '../_lib/cors.js'
import { findOrCreateZohoAccount } from '../_lib/zohoAccount.js'
import { zohoCrmHeaders } from '../_lib/zohoCrm.js'

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(400).json({ error: 'POST only' })

  const { name, city, state, website } = req.body || {}
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' })

  let token
  try { token = await getZohoToken() } catch (err) { return res.status(500).json({ error: err.message, setup: '/api/zoho-setup' }) }
  const headers = zohoCrmHeaders(token)

  try {
    const { id: accountId, created: accountCreated } = await findOrCreateZohoAccount({ name, city, state, website }, headers)
    if (!accountId) return res.status(502).json({ error: 'Could not find or create the Zoho Account for ' + name })
    return res.json({ ok: true, accountId, accountCreated })
  } catch (err) {
    console.error('[crm/account-name]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
