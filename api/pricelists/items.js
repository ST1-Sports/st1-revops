/**
 * POST /api/pricelists/items — bulk upsert price items for a supplier.
 * Used by commitImport(), updateProductCost(), updateOurPrice(), and the
 * one-time seed path. Field names mirror the PriceItem model exactly.
 * Body: { supplierId: string, products: PriceItem[] }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

function nullNum(v) { return v != null && v !== '' ? parseFloat(v) : null }

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const { supplierId, products } = req.body || {}
  if (!supplierId || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'supplierId and products[] are required' })
  }

  try {
    const ops = products.map(p => {
      const data = {
        supplierId,
        sku:       p.sku       || null,
        name:      p.name      || 'Unnamed',
        category:  p.category  || null,
        unit:      p.unit      || 'each',
        cost:      nullNum(p.cost),
        lastCost:  nullNum(p.lastCost),
        map:       nullNum(p.map),
        msrp:      nullNum(p.msrp),
        ourPrice:  nullNum(p.ourPrice),
        gmFloorPct: nullNum(p.gmFloorPct),
      }
      return prisma.priceItem.upsert({
        where:  { id: p.id },
        update: data,
        create: { id: p.id, ...data },
      })
    })

    const results = await prisma.$transaction(ops)
    return res.json({ ok: true, count: results.length })
  } catch (err) {
    console.error('[pricelists/items]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
