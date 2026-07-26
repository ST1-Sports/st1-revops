/**
 * POST /api/contacts/promote
 *
 * Push a RevOps cold-pool contact into Zoho CRM as a Lead.
 * Called manually (button) or automatically when a reply shows positive intent.
 *
 * Body: { contactId }
 * Returns: { ok, zohoId }
 */
import { setCors }      from '../_lib/cors.js'
import { prisma }       from '../_lib/prisma.js'
import { getZohoToken } from '../_lib/zoho-token.js'

const CRM_BASE = 'https://www.zohoapis.com/crm/v3'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const { contactId } = req.body || {}
  if (!contactId) return res.status(400).json({ error: 'contactId required' })

  const contact = await prisma.salesContact.findUnique({ where: { id: contactId } }).catch(() => null)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  let token
  try {
    token = await getZohoToken()
  } catch (err) {
    return res.status(500).json({ error: `Zoho auth: ${err.message}` })
  }

  try {
    const payload = {
      First_Name:   contact.firstName || '',
      Last_Name:    contact.lastName  || contact.email.split('@')[0],
      Company:      contact.companyName || '',
      Email:        contact.email,
      Phone:        contact.phone    || '',
      Designation:  contact.title    || '',
      Lead_Source:  'ST1 RevOps',
      Lead_Status:  'Working',
      Description:  contact.notes   || '',
    }

    const isUpdate = !!contact.zohoCrmId
    const url    = isUpdate ? `${CRM_BASE}/Leads/${contact.zohoCrmId}` : `${CRM_BASE}/Leads`
    const method = isUpdate ? 'PUT' : 'POST'

    const zohoRes = await fetch(url, {
      method,
      headers: {
        Authorization:  `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: [payload] }),
    })
    const data = await zohoRes.json()
    const record = data?.data?.[0]

    if (record?.status === 'error') {
      return res.status(502).json({ error: record.message || 'Zoho API error' })
    }

    const zohoId = record?.details?.id || contact.zohoCrmId

    await prisma.salesContact.update({
      where: { id: contactId },
      data:  { pushedToZoho: true, zohoCrmId: zohoId || undefined },
    })

    return res.json({ ok: true, zohoId })
  } catch (err) {
    console.error('[contacts/promote]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
