/**
 * POST /api/crm/deal
 *
 * Creates a Zoho CRM Deal properly linked to the customer's Account via a
 * real lookup id. Every Deal-creation call site in the app used to send
 * Account_Name as a bare name string (or omit it entirely) — Account_Name is
 * a lookup field, so that never actually linked the Deal to the Account,
 * which is why nothing showed up under the Account's Deals related list.
 *
 * Body: {
 *   dealName, accountName?, accountCity?, accountState?,
 *   amount?, stage?, closingDate?, description?
 * }
 * Returns: { ok, dealId, accountId, accountCreated }
 */
import { getZohoToken } from '../_lib/zoho-token.js'
import { setCors }      from '../_lib/cors.js'
import { findOrCreateZohoAccount } from '../_lib/zohoAccount.js'
import { zohoCrmHeaders, zohoCrmCreateRecord } from '../_lib/zohoCrm.js'

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const {
    dealName, accountName, accountCity, accountState,
    amount = 0, stage = 'Quoted', closingDate, description = '',
  } = req.body || {}

  if (!dealName) return res.status(400).json({ error: 'dealName required' })

  let token
  try { token = await getZohoToken() } catch (err) { return res.status(500).json({ error: err.message, setup: '/api/zoho-setup' }) }
  const headers = zohoCrmHeaders(token)

  try {
    let accountId = null, accountCreated = false
    if (accountName) {
      const account = await findOrCreateZohoAccount({ name: accountName, city: accountCity, state: accountState }, headers)
      accountId = account.id
      accountCreated = account.created
    }

    const dealPayload = {
      Deal_Name: dealName,
      Amount:    Number(amount) || 0,
      Stage:     stage,
      ...(closingDate  ? { Closing_Date: closingDate } : {}),
      ...(description  ? { Description: description } : {}),
      ...(accountId    ? { Account_Name: { id: accountId } } : {}),
    }

    const rec = await zohoCrmCreateRecord('Deals', dealPayload, headers)
    if (rec?.status === 'error') return res.status(502).json({ error: rec.message || 'Zoho deal creation failed', raw: rec })
    const dealId = rec?.details?.id
    if (!dealId) return res.status(502).json({ error: 'Zoho did not return a deal id' })

    return res.json({ ok: true, dealId, accountId, accountCreated })

  } catch (err) {
    console.error('[crm/deal]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
