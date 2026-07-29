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
