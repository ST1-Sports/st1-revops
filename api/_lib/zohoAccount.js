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
import { CRM_BASE, zohoCrmCreateRecord, zohoRecordId } from './zohoCrm.js'
import { pickBestZohoAccount, zohoAccountSearchWord } from './zohoAccountMatch.js'

function zohoCriteriaValue(value) {
  return String(value || '').replace(/[\\()]/g, '\\$&')
}

async function searchZohoAccounts(headers, criteria) {
  const searchRes = await fetch(
    `${CRM_BASE}/Accounts/search?criteria=${encodeURIComponent(criteria)}`,
    { headers }
  )
  if (!searchRes.ok) return []
  const data = await searchRes.json().catch(() => null)
  return data?.data || []
}

export async function findOrCreateZohoAccount({ name, city, state, website }, headers) {
  const trimmed = (name || '').trim()
  if (!trimmed) return { id: null, created: false, name: '' }

  try {
    const exact = await searchZohoAccounts(
      headers,
      `(Account_Name:equals:${zohoCriteriaValue(trimmed)})`
    )
    let existing = pickBestZohoAccount(exact, trimmed, state)

    if (!existing) {
      const word = zohoAccountSearchWord(trimmed)
      if (word) {
        const fuzzy = await searchZohoAccounts(
          headers,
          `(Account_Name:starts_with:${zohoCriteriaValue(word)})`
        )
        existing = pickBestZohoAccount(fuzzy, trimmed, state)
      }
    }

    if (existing?.id) {
      // Backfill Website on an existing Account only when it doesn't have one yet —
      // never overwrite a value someone already set.
      if (website && !existing.Website) {
        await fetch(`${CRM_BASE}/Accounts/${existing.id}`, {
          method: 'PUT', headers,
          body: JSON.stringify({ data: [{ id: existing.id, Website: website }] }),
        }).catch(() => {})
      }
      return { id: existing.id, created: false, name: existing.Account_Name || trimmed }
    }
  } catch { /* fall through to create */ }

  const rec = await zohoCrmCreateRecord('Accounts', {
    Account_Name:  trimmed,
    Billing_City:  city  || undefined,
    Billing_State: state || undefined,
    Website:       website || undefined,
  }, headers)
  if (rec?.status === 'error') throw new Error(rec.message || 'Zoho account create failed')
  const createdId = zohoRecordId(rec)
  if (!createdId) {
    throw new Error(`Zoho account create returned no id for "${trimmed}": ${JSON.stringify(rec).slice(0, 300)}`)
  }
  return { id: createdId, created: true, name: trimmed }
}
