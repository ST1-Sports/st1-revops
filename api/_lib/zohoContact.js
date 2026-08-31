import { CRM_BASE, zohoCrmCreateRecord, zohoRecordId } from './zohoCrm.js'

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { firstName: '', lastName: 'Contact' }
  if (parts.length === 1) return { firstName: '', lastName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/** Find a CRM Contact by email, or create one linked to the Account. */
export async function findOrCreateZohoContact({ fullName, email, accountId }, headers) {
  const trimmedEmail = String(email || '').trim()
  const names = splitName(fullName)
  if (!trimmedEmail && !fullName) return { id: null, created: false }

  if (trimmedEmail) {
    try {
      const criteria = `(Email:equals:${trimmedEmail})`
      const r = await fetch(`${CRM_BASE}/Contacts/search?criteria=${encodeURIComponent(criteria)}`, { headers })
      if (r.ok) {
        const data = await r.json().catch(() => null)
        const existing = data?.data?.[0]
        if (existing?.id) return { id: existing.id, created: false }
      }
    } catch { /* create */ }
  }

  const payload = {
    Last_Name: names.lastName || 'Contact',
    ...(names.firstName ? { First_Name: names.firstName } : {}),
    ...(trimmedEmail ? { Email: trimmedEmail } : {}),
    ...(accountId ? { Account_Name: { id: accountId } } : {}),
  }
  const rec = await zohoCrmCreateRecord('Contacts', payload, headers)
  if (rec?.status === 'error') return { id: null, created: false, error: rec.message }
  const id = zohoRecordId(rec)
  return { id, created: !!id }
}
