/**
 * Shape a Prisma Account row for the CRM UI, and normalize a typed website
 * into the Account.domain column (hostname only).
 */
export function websiteToDomain(website) {
  const w = String(website || '').trim()
  if (!w) return null
  try {
    const url = w.includes('://') ? new URL(w) : new URL(`https://${w}`)
    const host = (url.hostname || '').replace(/^www\./i, '')
    return host || null
  } catch {
    return w.slice(0, 200)
  }
}

export function mapAccountRow(row) {
  if (!row) return null
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    city: row.city || '',
    state: row.state || '',
    website: row.domain || meta.website || '',
    zohoAccountId: row.zohoAccountId || null,
  }
}
