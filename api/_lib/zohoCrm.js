/**
 * Shared low-level helpers for talking to the Zoho CRM v3 API — the small
 * bits every CRM-writing endpoint (api/crm/deal.js, api/crm/quote.js) needs
 * and would otherwise each hand-roll: the base URL, the auth header shape,
 * and posting one record to a module and reading back its per-record result.
 */
export const CRM_BASE = 'https://www.zohoapis.com/crm/v3'

// The "they've shown real intent" bar (a reply, a meeting, an actual deal
// touch) shared by every place that decides whether a contact is worth
// pushing to Zoho at all — score comes from the SCORE_CONTACT point system
// (replied:50, meeting:75, deal:100).
export const INTENT_SCORE_THRESHOLD = 50

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

/**
 * POST-or-PUT a record into a Zoho module — shared by every caller that
 * pushes a SalesContact into Leads or Contacts (api/contacts/promote.js,
 * api/contacts/zoho-align-accounts.js). Only treats this as an update if
 * the contact's existing zohoCrmId actually belongs to THIS module — a
 * contact promoted from Lead to Contact has a zohoCrmId pointing at the old
 * Lead record, and PUTing that id onto /Contacts would either 404 or hit an
 * unrelated record. In that case this creates a real new record instead;
 * the old Lead is left in Zoho rather than formally converted (Zoho's
 * Convert-Lead API would be the fuller fix, but isn't wired up here).
 *
 * Does not touch Prisma — callers persist zohoCrmId/zohoModule/pushedToZoho
 * (plus whatever else they need, e.g. zohoAccountId) themselves, since that
 * varies per caller.
 */
export async function upsertZohoRecord({ module, payload, contact, headers }) {
  const isUpdate = !!contact.zohoCrmId && contact.zohoModule === module
  const url    = isUpdate ? `${CRM_BASE}/${module}/${contact.zohoCrmId}` : `${CRM_BASE}/${module}`
  const method = isUpdate ? 'PUT' : 'POST'
  const res  = await fetch(url, { method, headers, body: JSON.stringify({ data: [payload] }) })
  const data = await res.json().catch(() => null)
  const rec  = data?.data?.[0]
  if (rec?.status === 'error') throw Object.assign(new Error(rec.message || 'Zoho API error'), { isZohoError: true })
  return { zohoCrmId: rec?.details?.id || contact.zohoCrmId, isUpdate }
}
