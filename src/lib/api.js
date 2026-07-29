/**
 * ST1 RevOps — Central AI client
 * All Anthropic calls go through /api/claude (Vercel serverless proxy).
 * The API key never touches the browser bundle.
 */

// In local dev (npm run dev): call Anthropic directly using VITE_ANTHROPIC_KEY
// In production on Vercel: route through /api/claude edge proxy (key stays server-side)
const IS_DEV   = typeof import.meta !== 'undefined' && import.meta.env?.DEV
const DEV_KEY  = typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_ANTHROPIC_KEY || '') : ''
const ENDPOINT = IS_DEV ? 'https://api.anthropic.com/v1/messages' : '/api/claude'

/**
 * Core call — mirrors Anthropic /v1/messages signature
 * @param {object} opts
 * @param {string} opts.prompt       - User message
 * @param {string} [opts.sys]        - System prompt
 * @param {number} [opts.tokens=900] - max_tokens
 * @param {boolean}[opts.search]     - Enable web search tool
 * @param {boolean}[opts.json]       - Parse response as JSON
 * @param {Array}  [opts.mcpServers] - MCP servers array
 * @returns {Promise<string|object|null>}
 */
export async function aiCall(prompt, opts = {}) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: opts.tokens || 900,
    messages: [{ role: 'user', content: prompt }],
  }

  if (opts.sys) {
    body.system = opts.json
      ? opts.sys + '\n\nReturn ONLY valid JSON. No markdown fences, no explanation.'
      : opts.sys
  } else if (opts.json) {
    body.system = 'Return ONLY valid JSON. No markdown fences, no explanation.'
  }

  if (opts.search) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }]
  }

  if (opts.mcpServers) {
    body.mcp_servers = opts.mcpServers
  }

  const headers = { 'Content-Type': 'application/json' }
  if (IS_DEV && DEV_KEY) {
    headers['x-api-key'] = DEV_KEY
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-beta'] = 'mcp-client-2025-04-04'
  }

  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!r.ok) {
    const err = await r.text().catch(() => 'unknown error')
    throw new Error(`Claude API ${r.status}: ${err.slice(0, 200)}`)
  }

  const d = await r.json()
  const text = (d.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')

  if (!opts.json) return text

  // Try full parse first (model returned clean JSON), then extract embedded JSON
  try { return JSON.parse(text.trim()) } catch {}
  try {
    const obj = text.match(/\{[\s\S]*\}/)
    const arr = text.match(/\[[\s\S]*\]/)
    const m = obj && arr
      ? (text.indexOf('{') < text.indexOf('[') ? obj : arr)
      : (obj || arr)
    return m ? JSON.parse(m[0]) : null
  } catch {
    return null
  }
}

/**
 * Send a Slack message via MCP through the proxy
 * Channel C09F64RK0MN = #all-st1-sports
 */
export async function slackSend(channelId, message) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      mcp_servers: [{ type: 'url', url: 'https://mcp.slack.com/mcp', name: 'slack' }],
      messages: [{
        role: 'user',
        content: `Send this exact message to Slack channel ${channelId} using the slack_send_message tool:\n\n${message}\n\nReply with just "sent".`
      }]
    })
  })
  if (!r.ok) throw new Error(`Slack proxy ${r.status}`)
  const d = await r.json()
  return d
}

/**
 * Zoho Books REST call (direct from browser — credentials stored locally)
 */
export async function booksAPI(endpoint, method = 'GET', body = null, token, orgId) {
  const sep = endpoint.includes('?') ? '&' : '?'
  const url = `https://www.zohoapis.com/books/v3${endpoint}${sep}organization_id=${orgId}`
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!r.ok) throw new Error(`Books ${r.status}`)
  return r.json()
}

/**
 * Zoho CRM REST call (direct from browser)
 */
export async function crmAPI(endpoint, method = 'GET', body = null, token) {
  const r = await fetch(`https://www.zohoapis.com/crm/v3${endpoint}`, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!r.ok) throw new Error(`CRM ${r.status}`)
  return r.json()
}
