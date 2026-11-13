/**
 * POST /api/pricelists/market — retired. Quoting reads the ST1 PIM catalog.
 */
import { setCors } from '../_lib/cors.js'
import { requireSignedIn } from '../_lib/requireSignedIn.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!(await requireSignedIn(req, res))) return
  return res.status(410).json({
    error: 'Price lists have been replaced by the ST1 PIM catalog. Use get_st1_pricing or Edgar.',
  })
}
