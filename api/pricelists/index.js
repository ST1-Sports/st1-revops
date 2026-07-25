/**
 * GET /api/pricelists — own supplier lists and competitor price lists.
 * Own suppliers: full cost + ourPrice data for margin calculations.
 * Competitors: tagged __COMPETITOR__: in category, cost = their sell price.
 * Edgar uses both: own for cost/margin, competitors for pricing strategy.
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

const COMP_PREFIX = '__COMPETITOR__:'

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
    scannedAt:      item.scannedAt  ? item.scannedAt.toISOString()             : null,
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

function mapCompetitor(sup) {
  const competitorName = sup.category?.startsWith(COMP_PREFIX)
    ? sup.category.slice(COMP_PREFIX.length)
    : sup.name
  return {
    id:             sup.id,
    name:           sup.name,
    competitorName,
    notes:          sup.notes,
    lastUpdated:    sup.lastUpdated ? sup.lastUpdated.toISOString().slice(0,10) : null,
    // items: cost = their sell price; ourPrice = null
    items:          (sup.items || []).map(mapItem),
  }
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' })

  try {
    const all = await prisma.supplier.findMany({
      where:   { active: true },
      include: { items: { orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    })

    const suppliers   = all.filter(s => !s.category?.startsWith(COMP_PREFIX))
    const competitors = all.filter(s =>  s.category?.startsWith(COMP_PREFIX))

    return res.json({
      ok:          true,
      suppliers:   suppliers.map(mapSupplier),
      competitors: competitors.map(mapCompetitor),
    })
  } catch (err) {
    console.error('[pricelists/GET]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
