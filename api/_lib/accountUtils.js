/**
 * Account (company/school) helpers shared across contact-creation endpoints.
 *
 * There's no fuzzy matching here on purpose — normalizeAccountName only
 * trims/lowercases/collapses whitespace. That catches casing and stray-space
 * duplicates ("Lincoln High School" vs "lincoln  high school") without the
 * false-merge risk of stripping suffixes like "High School"/"HS", which could
 * just as easily collide two genuinely different schools.
 */
import { prisma } from './prisma.js'

export function normalizeAccountName(raw) {
  return (raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,]+$/g, '')
    .toLowerCase()
}

/** Find-or-create the Account for a company name, updating city/state if blank. Returns the Account id, or null if no name given. */
export async function upsertAccountForContact(companyName, { city, state, orgType } = {}) {
  const name = (companyName || '').trim()
  if (!name) return null
  const normalizedName = normalizeAccountName(name)
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
