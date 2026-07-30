/**
 * Shared Zoho CRM Account resolution — find the Account by name (disambiguating
 * by state if there are multiple same-named schools), or create it. Returns a
 * real lookup id so a Deal/Quote's Account_Name field actually links — sending
 * a bare name string there does not create a relational link in Zoho, which
 * was why Deals and Quotes weren't showing up under their Accounts.
 *
 * Used by every endpoint that creates a Deal or Quote (api/crm/deal.js,
 * api/crm/quote.js) so account-matching stays consistent everywhere instead
 * of each endpoint re-implementing its own slightly different version.
 */
import { CRM_BASE, zohoCrmCreateRecord } from './zohoCrm.js'

export async function findOrCreateZohoAccount({ name, city, state, website }, headers) {
  const trimmed = (name || '').trim()
  if (!trimmed) return { id: null, created: false }

  try {
    const criteria = `(Account_Name:equals:${trimmed})`
    const searchRes = await fetch(`${CRM_BASE}/Accounts/search?criteria=${encodeURIComponent(criteria)}`, { headers })
    if (searchRes.ok) {
      const data = await searchRes.json().catch(() => null)
      const matches = data?.data || []
      const existing = state && matches.length > 1
        ? (matches.find(m => (m.Billing_State || '').toLowerCase() === state.toLowerCase()) || matches[0])
        : matches[0]
      if (existing?.id) {
        // Backfill Website on an existing Account only when it doesn't have one yet —
        // never overwrite a value someone already set.
        if (website && !existing.Website) {
          await fetch(`${CRM_BASE}/Accounts/${existing.id}`, {
            method: 'PUT', headers,
            body: JSON.stringify({ data: [{ id: existing.id, Website: website }] }),
          }).catch(() => {})
        }
        return { id: existing.id, created: false }
      }
    }
  } catch { /* fall through to create */ }

  const rec = await zohoCrmCreateRecord('Accounts', {
    Account_Name:  trimmed,
    Billing_City:  city  || undefined,
    Billing_State: state || undefined,
    Website:       website || undefined,
  }, headers)
  if (rec?.status === 'error') throw new Error(rec.message || 'Zoho account create failed')
  return { id: rec?.details?.id || null, created: true }
}
