/**
 * GET /api/pricelists — retired.
 *
 * Uploaded dealer lists are no longer stored or quoted from. Scout and Edgar
 * read the ST1 PIM catalog. Historical PriceItem rows may still exist for
 * vendor-bill matching, but this HTTP API no longer reads or writes them.
 */
import { setCors } from '../_lib/cors.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  return res.status(410).json({
    error: 'Price lists have been replaced by the ST1 PIM catalog. Use get_st1_pricing or Edgar.',
  })
}
