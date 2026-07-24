/**
 * POST /api/pricelists/supplier — upsert a single supplier record.
 * Body: { id, name, category?, rep?, repEmail?, repPhone?, notes?, lastUpdated? }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const { id, name, category, rep, repEmail, repPhone, notes, lastUpdated } = req.body || {}
  if (!id || !name) return res.status(400).json({ error: 'id and name are required' })

  try {
    const data = {
      name,
      category:    category    || null,
      rep:         rep         || null,
      repEmail:    repEmail    || null,
      repPhone:    repPhone    || null,
      notes:       notes       || null,
      lastUpdated: lastUpdated ? new Date(lastUpdated) : null,
    }
    const supplier = await prisma.supplier.upsert({
      where:  { id },
      update: data,
      create: { id, ...data },
    })
    return res.json({ ok: true, supplier })
  } catch (err) {
    console.error('[pricelists/supplier]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
