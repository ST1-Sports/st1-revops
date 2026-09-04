import { prisma } from './prisma.js'
import { notifyBradSlack } from './brad-shared.js'
import { failedBradSlackRows, loadSlackWebhook, loadCanChatPost } from './slack.js'

export async function canSendBradSlack() {
  if (await loadSlackWebhook()) return true
  return (await loadCanChatPost()) === true
}

export async function replayFailedBradSlack({ limit = 25 } = {}) {
  if (!(await canSendBradSlack())) {
    return { ok: false, replayed: 0, remaining: 0, error: 'Slack still cannot post — save an Incoming Webhook URL first' }
  }
  const rows = await prisma.agentInteraction.findMany({
    where: { agentId: 'brad', action: 'reply_intent' },
    orderBy: { createdAt: 'desc' },
    take: 80,
  })
  const failed = failedBradSlackRows(rows).slice(0, limit)
  let replayed = 0
  const errors = []
  for (const row of failed) {
    const inp = row.input || {}
    const out = row.output || {}
    const assigned = { name: out.assignedName || 'Matt Stone', email: out.assignedTo || 'matt@st1sports.com' }
    const slack = await notifyBradSlack(assigned, inp.contactName || inp.fromEmail, inp.fromEmail, inp.subject, inp.snippet)
    const next = { ...out, slack: slack?.ok ? 'sent' : (slack?.error || 'failed') }
    await prisma.agentInteraction.update({ where: { id: row.id }, data: { output: next } }).catch(() => {})
    if (slack?.ok) replayed += 1
    else errors.push(slack?.error || 'failed')
  }
  return {
    ok: replayed > 0 || failed.length === 0,
    replayed,
    remaining: failed.length - replayed,
    error: replayed ? null : (errors[0] || null),
  }
}
