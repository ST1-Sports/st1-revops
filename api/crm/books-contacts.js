/**
 * GET /api/crm/books-contacts?customerId=...
 *
 * Zoho Books keeps its own Contact Persons per Customer — separate from
 * Zoho CRM's Contacts/Leads. Quotes/deals stay in CRM (never Books), but
 * once a deal closes and Books has real invoices for a customer, its Books
 * contact persons are still useful to see on the Account (may include an
 * AP/billing contact CRM never captured).
 *
 * Returns: { ok, contacts: [{name, email, phone, isPrimary}] }
 */
import { setCors } from '../_lib/cors.js'
import { booksGet } from '../_lib/zoho-books.js'

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET')    return res.status(405).json({ error: 'GET only' })

  const { customerId } = req.query || {}
  if (!customerId) return res.status(400).json({ error: 'customerId required' })

  try {
    const data = await booksGet(`/contacts/${customerId}/contactpersons`)
    const contacts = (data.contact_persons || []).map(p => ({
      name:      [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Contact',
      email:     p.email || '',
      phone:     p.phone || p.mobile || '',
      isPrimary: !!p.is_primary_contact,
    }))
    return res.json({ ok: true, contacts })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
