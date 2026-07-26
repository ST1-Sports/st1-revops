/**
 * Shared Zoho Books fetch helpers used by all Ledger API routes.
 */

import { getZohoToken } from './zoho-token.js'

export const ORG   = process.env.ZOHO_ORG_ID || '899940777'
export const BOOKS = 'https://www.zohoapis.com/books/v3'

async function booksHeaders() {
  const token = await getZohoToken()
  return { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }
}

export async function booksGet(path) {
  const headers = await booksHeaders()
  const sep     = path.includes('?') ? '&' : '?'
  const r       = await fetch(`${BOOKS}${path}${sep}organization_id=${ORG}`, { headers })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`Books GET ${path}: ${r.status} — ${txt.slice(0, 200)}`)
  }
  return r.json()
}

export async function booksPost(path, body) {
  const headers = await booksHeaders()
  const sep     = path.includes('?') ? '&' : '?'
  const r       = await fetch(`${BOOKS}${path}${sep}organization_id=${ORG}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`Books POST ${path}: ${r.status} — ${txt.slice(0, 200)}`)
  }
  return r.json()
}

export function isPrismaTableMissing(e) {
  return e.code === 'P2021' || e.message?.includes('does not exist')
}
