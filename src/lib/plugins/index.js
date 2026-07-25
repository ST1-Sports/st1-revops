/**
 * ST1 Plugin Registry
 *
 * getPlugin(capability, userRole)  → plugin | null
 * getAllPlugins()                  → plugin[]
 * registerPlugin(plugin)          → void
 * setPluginEnabled(id, enabled)   → void
 */

import { aiCall } from '../api.js'

const CUSTOM_TOOLS_KEY = 'st1_custom_tools'
const PREFS_KEY        = 'st1_tool_prefs'

// ── Internal maps ─────────────────────────────────────────────────────────────
const _byId  = new Map()   // id  → plugin
const _byCap = new Map()   // cap → plugin[]

function _upsert(plugin) {
  _byId.set(plugin.id, plugin)
  const caps = Array.isArray(plugin.capabilities) ? plugin.capabilities : [plugin.capabilities ?? 'general']
  for (const cap of caps) {
    if (!_byCap.has(cap)) _byCap.set(cap, [])
    const list = _byCap.get(cap)
    const i = list.findIndex(p => p.id === plugin.id)
    if (i >= 0) list[i] = plugin
    else list.push(plugin)
  }
}

// ── Shared ST1 context ────────────────────────────────────────────────────────
const ST1_CTX =
  'You are an AI assistant for ST1 Sports, a nationwide B2B athletic equipment supplier ' +
  'carrying Wilson, DeMarini, Louisville Slugger, EvoShield, Warstic, Diamond, All-Star, ' +
  'Molten, Gill Athletics, ATEC and more. Primary customers are K-12 athletic directors, ' +
  'coaches, and administrators at tax-exempt institutions.'

// ── Built-in plugin definitions ───────────────────────────────────────────────
const BUILT_INS = [
  {
    id:           'st1-copy',
    name:         'Sales Copywriter',
    capabilities: ['copy'],
    type:         'claude',
    roles:        ['admin', 'manager', 'sales_rep'],
    requiresKeys: [],
    enabled:      true,
    handler: async (task) => {
      const output = await aiCall(task, {
        sys:    ST1_CTX + ' You are a B2B sales copywriter. Be direct, concise, and sport-specific. Under 200 words per email variant.',
        tokens: 2500,
      })
      return { output, metadata: {} }
    },
  },
  {
    id:           'st1-social',
    name:         'Social Media',
    capabilities: ['social'],
    type:         'claude',
    roles:        ['admin', 'manager', 'sales_rep'],
    requiresKeys: [],
    enabled:      true,
    handler: async (task) => {
      const output = await aiCall(task, {
        sys:    ST1_CTX + ' You are a social media content specialist. Write platform-appropriate copy with relevant hashtags.',
        tokens: 1500,
      })
      return { output, metadata: {} }
    },
  },
  {
    id:           'st1-image',
    name:         'Image Generator',
    capabilities: ['image'],
    type:         'ideogram',
    roles:        ['admin', 'manager', 'sales_rep'],
    requiresKeys: ['IDEOGRAM_API_KEY'],
    enabled:      true,
    handler: async (task) => {
      // Returns a crafted image prompt — CommandCenter calls the image API with it
      const output = await aiCall(task, {
        sys:    'You create concise, vivid image generation prompts for athletic sports marketing. ' +
                'Include mood, setting, lighting, and composition details. Return ONLY the prompt text, no preamble.',
        tokens: 300,
      })
      return { output, metadata: { type: 'image_prompt' } }
    },
  },
  {
    id:           'st1-research',
    name:         'Research & Intel',
    capabilities: ['research'],
    type:         'claude-search',
    roles:        ['admin', 'manager', 'sales_rep'],
    requiresKeys: [],
    enabled:      true,
    handler: async (task) => {
      const output = await aiCall(task, {
        sys:    ST1_CTX + ' You are a market research specialist. Provide thorough, well-cited research with specific source URLs.',
        tokens: 3000,
        search: true,
      })
      return { output, metadata: {} }
    },
  },
  {
    id:           'st1-finance',
    name:         'Financial Summaries',
    capabilities: ['finance'],
    type:         'claude',
    roles:        ['admin'],
    requiresKeys: [],
    enabled:      true,
    handler: async (task) => {
      const output = await aiCall(task, {
        sys:    ST1_CTX + ' You are a financial analyst. Provide clear, actionable summaries of business data in plain English.',
        tokens: 2000,
      })
      return { output, metadata: {} }
    },
  },
  {
    id:           'st1-competitor-intel',
    name:         'Competitor Intel',
    capabilities: ['competitor-intel'],
    type:         'claude-search',
    roles:        ['admin', 'manager'],
    requiresKeys: [],
    enabled:      true,
    handler: async (task) => {
      const output = await aiCall(task, {
        sys:    ST1_CTX + ' You are a competitive intelligence analyst. Research competitors, pricing, and market positioning.',
        tokens: 2000,
        search: true,
      })
      return { output, metadata: {} }
    },
  },
  {
    id:           'st1-workflow',
    name:         'Workflow Automation',
    capabilities: ['workflow'],
    type:         'claude',
    roles:        ['admin'],
    requiresKeys: [],
    enabled:      true,
    handler: async (task) => {
      const output = await aiCall(task, {
        sys:    ST1_CTX + ' You are a workflow automation specialist. Help configure and optimize business processes.',
        tokens: 1500,
      })
      return { output, metadata: {} }
    },
  },
  {
    id:           'st1-general',
    name:         'General Assistant',
    capabilities: ['general'],
    type:         'claude',
    roles:        ['admin', 'manager', 'sales_rep'],
    requiresKeys: [],
    enabled:      true,
    handler: async (task) => {
      const output = await aiCall(task, { sys: ST1_CTX, tokens: 1500 })
      return { output, metadata: {} }
    },
  },
]

for (const p of BUILT_INS) _upsert(p)

// ── Custom tool handler factory ───────────────────────────────────────────────
function buildHandler(tool) {
  return async (task, input) => {
    const url = tool.config?.webhookUrl || tool.config?.apiUrl || ''
    if ((tool.type === 'webhook' || tool.type === 'api') && url) {
      const r = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ task, input }),
      })
      if (!r.ok) throw new Error(`${tool.name} webhook returned HTTP ${r.status}`)
      const d = await r.json().catch(() => ({}))
      return { output: d.output ?? JSON.stringify(d, null, 2), metadata: d }
    }
    return {
      output:   tool.config?.notes || `Tool "${tool.name}" (${tool.type}) has no runtime handler configured.`,
      metadata: {},
    }
  }
}

// ── Bootstrap: apply persisted prefs then load custom tools ───────────────────
try {
  const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  for (const [id, enabled] of Object.entries(prefs)) {
    const p = _byId.get(id)
    if (p) p.enabled = enabled
  }
} catch {}

// Sync bootstrap from localStorage so custom tools appear immediately on load.
try {
  const customs = JSON.parse(localStorage.getItem(CUSTOM_TOOLS_KEY) || '[]')
  for (const t of Array.isArray(customs) ? customs : []) {
    _upsert({ ...t, handler: buildHandler(t) })
  }
} catch {}

/**
 * Refresh custom tools from DB (authoritative). Falls back to localStorage cache
 * if the fetch fails. Call once on app init (ToolManager.useEffect).
 */
export async function loadCustomTools() {
  let tools = []
  try {
    const r = await fetch('/api/admin/tools')
    if (r.ok) {
      const d = await r.json()
      tools = Array.isArray(d.tools) ? d.tools : []
      // Sync to localStorage so next hard-refresh is instant.
      try { localStorage.setItem(CUSTOM_TOOLS_KEY, JSON.stringify(tools)) } catch {}
    }
  } catch {}
  if (!tools.length) {
    try { tools = JSON.parse(localStorage.getItem(CUSTOM_TOOLS_KEY) || '[]') } catch {}
  }
  for (const t of Array.isArray(tools) ? tools : []) {
    _upsert({ ...t, handler: buildHandler(t) })
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function getPlugin(capability, userRole = 'sales_rep') {
  const list = _byCap.get(capability) || []
  return (
    list.find(p => p.enabled !== false && (!p.roles || p.roles.includes(userRole))) ||
    list.find(p => p.enabled !== false) ||
    null
  )
}

export function getAllPlugins() {
  return [..._byId.values()]
}

export function registerPlugin(plugin) {
  _upsert({ ...plugin, handler: plugin.handler ?? buildHandler(plugin) })
}

export function setPluginEnabled(id, enabled) {
  const plugin = _byId.get(id)
  if (!plugin) return
  plugin.enabled = enabled
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    prefs[id] = enabled
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {}
  if (plugin.custom) {
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_TOOLS_KEY) || '[]')
      localStorage.setItem(CUSTOM_TOOLS_KEY, JSON.stringify(
        saved.map(t => t.id === id ? { ...t, enabled } : t)
      ))
    } catch {}
  }
}

export function deleteCustomTool(id) {
  const plugin = _byId.get(id)
  if (!plugin?.custom) return
  _byId.delete(id)
  for (const list of _byCap.values()) {
    const i = list.findIndex(p => p.id === id)
    if (i >= 0) list.splice(i, 1)
  }
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_TOOLS_KEY) || '[]')
    localStorage.setItem(CUSTOM_TOOLS_KEY, JSON.stringify(saved.filter(t => t.id !== id)))
  } catch {}
}
