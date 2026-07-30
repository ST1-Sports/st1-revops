/**
 * Account (company/school) helpers shared across contact-creation endpoints.
 *
 * There's no fuzzy matching here on purpose — normalizeAccountName only
 * trims/lowercases/collapses whitespace. That catches casing and stray-space
 * duplicates ("Lincoln High School" vs "lincoln  high school") without the
 * false-merge risk of stripping suffixes like "High School"/"HS", which could
 * just as easily collide two genuinely different schools.
 *
 * The dedup key (stored in Account.normalizedName, still @unique) includes
 * state on top of the normalized name — "Lincoln High School" in Iowa and in
 * Texas are two different real schools and must never collapse into one
 * Account just because they share a name. When state is unknown at creation
 * time, the key falls back to name-only, so two same-named, state-unknown
 * contacts still dedup together (the same tradeoff as before this fix).
 */
import { prisma } from './prisma.js'

export function normalizeAccountName(raw) {
  return (raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,]+$/g, '')
    .toLowerCase()
}

export function accountDedupKey(name, state) {
  const n = normalizeAccountName(name)
  if (!n) return ''
  const s = (state || '').trim().toLowerCase()
  return s ? `${n}|${s}` : n
}

/** Find-or-create the Account for a company name, updating city/state if blank. Returns the Account id, or null if no name given. */
export async function upsertAccountForContact(companyName, { city, state, orgType } = {}) {
  const name = (companyName || '').trim()
  if (!name) return null
  const normalizedName = accountDedupKey(name, state)
  if (!normalizedName) return null
  const account = await prisma.account.upsert({
    where: { normalizedName },
    create: { name, normalizedName, city: city || null, state: state || null, orgType: orgType || 'school' },
    update: {
      city: city || undefined,
      state: state || undefined,
    },
  })
  return account.id
}

const CRM_BASE = 'https://www.zohoapis.com/crm/v3'

/**
 * Find-or-create the Zoho CRM Account for {name, city, state} and return its
 * Zoho id. Shared by every caller that needs a real Zoho Account behind a
 * local Account/contact — a search by Account_Name alone can return more
 * than one same-named school, so when we know the state and there's more
 * than one match, the one whose Billing_State agrees wins. Creation always
 * sends Billing_City/Billing_State so the Zoho record carries location too.
 */
export async function findOrCreateZohoAccount({ name, city, state }, headers) {
  const trimmedName = (name || '').trim()
  if (!trimmedName) return null

  try {
    const criteria = `(Account_Name:equals:${trimmedName})`
    const searchRes = await fetch(`${CRM_BASE}/Accounts/search?criteria=${encodeURIComponent(criteria)}`, { headers })
    if (searchRes.ok) {
      const searchData = await searchRes.json().catch(() => null)
      const matches = searchData?.data || []
      const existing = state && matches.length > 1
        ? (matches.find(m => (m.Billing_State || '').toLowerCase() === state.toLowerCase()) || matches[0])
        : matches[0]
      if (existing?.id) return existing.id
    }
  } catch {}

  const createRes = await fetch(`${CRM_BASE}/Accounts`, {
    method: 'POST', headers,
    body: JSON.stringify({ data: [{
      Account_Name: trimmedName,
      Billing_City:  city  || undefined,
      Billing_State: state || undefined,
    }] }),
  })
  const createData = await createRes.json().catch(() => null)
  const rec = createData?.data?.[0]
  if (rec?.status === 'error') throw new Error(rec.message || 'Zoho account create failed')
  return rec?.details?.id || null
}
