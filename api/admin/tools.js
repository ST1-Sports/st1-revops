/**
 * GET  /api/admin/tools      — list all custom tools stored in AgentMemory
 * POST /api/admin/tools      — upsert a custom tool (body = tool object with id + name)
 * DELETE /api/admin/tools?id — remove a custom tool by id
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

const SCOPE  = 'tools'
const ENTITY = 'registry'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'GET') {
      const rows = await prisma.agentMemory.findMany({
        where:   { scope: SCOPE, entity: ENTITY },
        orderBy: { updatedAt: 'asc' },
      })
      const tools = rows.map(r => { try { return JSON.parse(r.value) } catch { return null } }).filter(Boolean)
      return res.json({ ok: true, tools })
    }

    if (req.method === 'POST') {
      const tool = req.body
      if (!tool?.id || !tool?.name) return res.status(400).json({ error: 'id and name required' })
      await prisma.agentMemory.upsert({
        where:  { scope_entity_key: { scope: SCOPE, entity: ENTITY, key: tool.id } },
        update: { value: JSON.stringify(tool), updatedAt: new Date() },
        create: { scope: SCOPE, entity: ENTITY, key: tool.id, value: JSON.stringify(tool) },
      })
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id
      if (!id) return res.status(400).json({ error: 'id query param required' })
      await prisma.agentMemory.deleteMany({
        where: { scope: SCOPE, entity: ENTITY, key: id },
      })
      return res.json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[admin/tools]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
