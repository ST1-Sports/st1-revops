/**
 * GET /api/pricelists — all active suppliers with their items.
 * Shape mirrors PriceTool.jsx's `suppliers` state so the component
 * can drop in the DB response with no reshaping.
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

function dec(v) { return v == null ? null : Number(v) }

function mapItem(item) {
  return {
    id:             item.id,
    supplierId:     item.supplierId,
    sku:            item.sku,
    name:           item.name,
    category:       item.category,
    unit:           item.unit || 'each',
    cost:           dec(item.cost),
    lastCost:       dec(item.lastCost),
    map:            dec(item.map),
    msrp:           dec(item.msrp),
    ourPrice:       dec(item.ourPrice),
    gmFloorPct:     item.gmFloorPct,
    marketLow:      dec(item.marketLow),
    marketHigh:     dec(item.marketHigh),
    competitors:    item.competitors || [],
    recommendation: item.recommendation,
    marketNote:     item.marketNote,
    scannedAt:      item.scannedAt  ? item.scannedAt.toISOString()        : null,
    updatedAt:      item.updatedAt  ? item.updatedAt.toISOString().slice(0,10) : null,
  }
}

function mapSupplier(sup) {
  return {
    id:          sup.id,
    name:        sup.name,
    category:    sup.category,
    rep:         sup.rep,
    repEmail:    sup.repEmail,
    repPhone:    sup.repPhone,
    notes:       sup.notes,
    lastUpdated: sup.lastUpdated ? sup.lastUpdated.toISOString().slice(0,10) : null,
    active:      sup.active,
    products:    (sup.items || []).map(mapItem),
  }
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' })

  try {
    const suppliers = await prisma.supplier.findMany({
      where:   { active: true },
      include: { items: { orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    })
    return res.json({ ok: true, suppliers: suppliers.map(mapSupplier) })
  } catch (err) {
    console.error('[pricelists/GET]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
