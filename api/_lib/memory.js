/**
 * ST1 Agent Brain — shared memory + interaction log.
 *
 * Every agent (Edgar, Brad, orchestrator, and any future agent) uses these
 * helpers. This is the layer that makes the platform "get smarter":
 *   - remember() / recall()  → durable facts about customers, districts, prefs
 *   - logInteraction()       → one row per action
 *   - recordOutcome()        → close the loop (won/lost/replied) later
 *   - recentOutcomes()       → feed prior results back into a new prompt
 *   - countActions()         → power rate limits / guardrails without a new table
 */
import { prisma } from './prisma.js'

// ── MEMORY ────────────────────────────────────────────────────────────────────

/**
 * Recall facts. Pass an entity ("customer:Cheyenne Mtn HS") to get everything
 * known about it, optionally narrowed to a single key.
 * @returns {Promise<Array<{key,value,agentId,confidence,updatedAt}>>}
 */
export async function recall({ entity, scope = 'org', key } = {}) {
  const where = { scope }
  if (entity) where.entity = entity
  if (key)    where.key = key
  return prisma.agentMemory.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })
}

/** Upsert a single fact. Later writes to the same (scope, entity, key) overwrite. */
export async function remember({ scope = 'org', entity = null, key, value, agentId, confidence = 1.0 }) {
  const v = typeof value === 'string' ? value : JSON.stringify(value)
  return prisma.agentMemory.upsert({
    where:  { scope_entity_key: { scope, entity, key } },
    update: { value: v, agentId, confidence, updatedAt: new Date() },
    create: { scope, entity, key, value: v, agentId, confidence },
  })
}

/** Render an entity's memory as a compact block to inject into a system prompt. */
export async function memoryBlock(entity, scope = 'org') {
  const facts = await recall({ entity, scope })
  if (!facts.length) return ''
  const lines = facts.map(f => `- ${f.key}: ${f.value}`).join('\n')
  return `What we already know about ${entity}:\n${lines}`
}

// ── INTERACTIONS + OUTCOMES ────────────────────────────────────────────────────

export async function logInteraction({
  agentId, userId = null, action, entity = null,
  input = {}, output = {}, outcome = 'pending', blockedBy = null, dryRun = false,
}) {
  return prisma.agentInteraction.create({
    data: { agentId, userId, action, entity, input, output, outcome, blockedBy, dryRun },
  })
}

export async function recordOutcome(interactionId, outcome) {
  return prisma.agentInteraction.update({
    where: { id: interactionId },
    data:  { outcome, outcomeAt: new Date() },
  })
}

/** Recent closed outcomes for a given agent/entity — the feedback signal. */
export async function recentOutcomes({ agentId, entity = null, limit = 5 }) {
  const where = { agentId, outcome: { not: 'pending' } }
  if (entity) where.entity = entity
  return prisma.agentInteraction.findMany({
    where, orderBy: { outcomeAt: 'desc' }, take: limit,
  })
}

/** Recent activity for an entity across all agents, any outcome — a timeline, not just closed feedback. */
export async function recentActivity(entity, limit = 8) {
  if (!entity) return []
  return prisma.agentInteraction.findMany({
    where:   { entity },
    orderBy: { createdAt: 'desc' },
    take:    limit,
  })
}

/** Count actions in a rolling window — used for rate limits (no extra table). */
export async function countActions({ agentId, action, sinceMs }) {
  return prisma.agentInteraction.count({
    where: {
      agentId, action, dryRun: false, blockedBy: null,
      createdAt: { gte: new Date(Date.now() - sinceMs) },
    },
  })
}
