/**
 * Shared low-level helpers for talking to the Zoho CRM v3 API — the small
 * bits every CRM-writing endpoint (api/crm/deal.js, api/crm/quote.js) needs
 * and would otherwise each hand-roll: the base URL, the auth header shape,
 * and posting one record to a module and reading back its per-record result.
 */
export const CRM_BASE = 'https://www.zohoapis.com/crm/v3'

export function zohoCrmHeaders(token) {
  return { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }
}

/**
 * POST one record to a Zoho CRM module. Returns the raw per-record result
 * (Zoho's `{status, details, message}` shape for that item) rather than
 * throwing, so callers that need to react to a rejected record — e.g.
 * retrying with a trimmed-down payload — can inspect `status === 'error'`
 * themselves instead of catching an exception.
 */
export async function zohoCrmCreateRecord(module, payload, headers) {
  const res = await fetch(`${CRM_BASE}/${module}`, {
    method: 'POST', headers, body: JSON.stringify({ data: [payload] }),
  })
  const data = await res.json().catch(() => null)
  return data?.data?.[0] || null
}
