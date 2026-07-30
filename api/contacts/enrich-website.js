/**
 * POST /api/contacts/enrich-website
 *
 * Looks up an organization's official website via Claude's web_search tool
 * (real search results only — Claude is instructed to return null rather
 * than guess a URL it isn't confident about) and, if a local Account row
 * exists for it, saves the result to Account.metadata.website + domain so
 * it doesn't need to be re-searched next time.
 *
 * Body: { name, city?, state?, accountId? }
 * Returns: { ok, website: string|null }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const { name, city, state, accountId } = req.body || {}
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' })

  const apiKey = process.env.ANTHROPIC_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' })

  const locationHint = [city, state].filter(Boolean).join(', ')
  const query = `${name}${locationHint ? ' ' + locationHint : ''} official athletics website`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{
          role: 'user',
          content: `Search for: ${query}\n\nFind the official website for this school/organization (its athletics department page or main site — whichever is the real, canonical site). Only use a URL that actually appeared in your search results — never guess or fabricate one. Reply with ONLY a JSON object on the last line, nothing else after it: {"website": "https://..."} or {"website": null} if you can't confidently find one.`,
        }],
      }),
    })
    if (!r.ok) {
      const txt = await r.text()
      return res.status(502).json({ error: `Anthropic ${r.status}: ${txt.slice(0, 200)}` })
    }
    const data = await r.json()
    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
    const match = textBlocks.match(/\{[^{}]*"website"[^{}]*\}/)
    let website = null
    if (match) {
      try { website = JSON.parse(match[0]).website || null } catch { /* leave null */ }
    }

    if (website && accountId) {
      try {
        const domain = new URL(website).hostname.replace(/^www\./, '')
        const existing = await prisma.account.findUnique({ where: { id: accountId } })
        await prisma.account.update({
          where: { id: accountId },
          data: {
            domain: domain || existing?.domain,
            metadata: { ...(existing?.metadata || {}), website },
          },
        })
      } catch { /* non-fatal — still return the found website */ }
    }

    return res.json({ ok: true, website })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
