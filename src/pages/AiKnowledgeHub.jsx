import React, { useEffect, useMemo, useState } from 'react'

const B = {
  pageBg: '#F2F2F0',
  white: '#FFFFFF',
  surface: '#F8F7F5',
  orange: '#F37321',
  orangeBg: '#FEF3EC',
  black: '#000000',
  border: '#E2E0DB',
  text: '#1A1A18',
  muted: '#7A7872',
  green: '#1E8F4E',
  greenBg: '#EAF7EE',
  yellow: '#C77800',
  yellowBg: '#FFF8E6',
  red: '#C0392B',
  redBg: '#FDECEA',
  blue: '#1A5FA8',
  blueBg: '#E8F0FA',
}

const TOOL_EXAMPLES = {
  search_st1_knowledge: { query: 'pricing policy', domains: ['policies', 'pricing'], limit: 5 },
  get_st1_pricing: { sku: 'MT123', brand: 'New Balance', includeAlternatives: true },
  get_st1_product: { productName: 'hurdle', includeAlternatives: true },
  get_st1_vendor: { query: 'New Balance', limit: 5 },
  get_st1_brand: { brandName: 'ST1 Sports' },
  get_st1_customer: { query: 'Lincoln', limit: 5 },
  get_st1_policy: { policyType: 'ai_tool_safety' },
}

const SOURCE_MAP = [
  {
    name: 'AI tool API',
    owner: 'Vercel env + /api/ai/tools',
    content: 'Tool schemas, permission scopes, and provider formats.',
    add: 'Set ST1_AI_TOOL_API_KEY, ST1_AI_TOOL_KEY, or ST1_AI_TOOL_API_KEYS in Vercel.',
  },
  {
    name: 'Pricing and cost',
    owner: 'Zoho Books Items',
    content: 'SKU, customer rate, purchase rate, unit, vendor item fields.',
    add: 'Maintain item rates and purchase rates in Zoho Books. The tool returns null instead of guessing missing cost.',
  },
  {
    name: 'Product catalog',
    owner: 'WooCommerce sync / ST1 Product table',
    content: 'Product names, prices, stock status, categories, tags, attributes, images, links.',
    add: 'Sync WooCommerce products through the existing product sync flow.',
  },
  {
    name: 'Customers and leads',
    owner: 'ST1 sales contacts + Zoho CRM',
    content: 'Contacts, leads, company/school, email, phone, status, score.',
    add: 'Add contacts in RevOps/CRM or sync from Zoho CRM. Notes require customer:read:notes scope.',
  },
  {
    name: 'Vendors and brands',
    owner: 'Zoho item vendor fields + product brand fields',
    content: 'Vendor names where available, inferred brand context, matching items.',
    add: 'Keep vendor/manufacturer fields current in Zoho Books and product brand fields.',
  },
  {
    name: 'Policies and playbooks',
    owner: 'Internal policy library + Prisma config',
    content: 'AI safety, pricing rules, customer data rules, brand voice, sponsorship config, talk track.',
    add: 'Update code policy definitions or admin/database-backed sponsorship and talk-track records.',
  },
]

function readLocalSummary() {
  try {
    const raw = localStorage.getItem('st1_revops_v2')
    if (!raw) return []
    const s = JSON.parse(raw)
    return [
      ['Contacts', s.contacts?.length || 0],
      ['Deals', s.deals?.length || 0],
      ['RFPs', s.rfps?.length || 0],
      ['Price lists', s.priceLists?.length || 0],
      ['Competitor intel', s.competeIntel?.length || 0],
      ['Campaigns', s.campaigns?.length || 0],
      ['Orders', s.orders?.length || 0],
      ['Reorders', s.reorders?.length || 0],
    ]
  } catch {
    return []
  }
}

function Card({ children, style }) {
  return (
    <div style={{
      background: B.white,
      border: `1px solid ${B.border}`,
      borderRadius: 10,
      boxShadow: '0 1px 4px rgba(0,0,0,.05)',
      padding: 18,
      ...style,
    }}>
      {children}
    </div>
  )
}

function Label({ children }) {
  return <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted, letterSpacing: 1.8, marginBottom: 6 }}>{children}</div>
}

function StatusPill({ ok, label }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      background: ok ? B.greenBg : B.yellowBg,
      color: ok ? B.green : B.yellow,
      border: `1px solid ${ok ? B.green : B.yellow}30`,
      borderRadius: 999,
      padding: '4px 9px',
      fontFamily: "'Lexend Zetta',sans-serif",
      fontSize: 8,
      letterSpacing: .8,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? B.green : B.yellow }} />
      {label}
    </span>
  )
}

function CopyButton({ text, label = 'COPY' }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <button onClick={copy} style={{ background: copied ? B.greenBg : B.surface, color: copied ? B.green : B.muted, border: `1px solid ${copied ? B.green : B.border}`, borderRadius: 5, padding: '5px 10px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: .8 }}>
      {copied ? 'COPIED' : label}
    </button>
  )
}

export default function AiKnowledgeHub({ embedded = false }) {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('st1_ai_tool_key') || '')
  const [discovery, setDiscovery] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedTool, setSelectedTool] = useState('get_st1_pricing')
  const [inputText, setInputText] = useState(JSON.stringify(TOOL_EXAMPLES.get_st1_pricing, null, 2))
  const [callResult, setCallResult] = useState(null)
  const [calling, setCalling] = useState(false)
  const [documents, setDocuments] = useState([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docTitle, setDocTitle] = useState('')
  const [docContent, setDocContent] = useState('')
  const [docMessage, setDocMessage] = useState('')

  const localSummary = useMemo(() => readLocalSummary(), [])
  const tools = discovery?.tools || []
  const selectedSchema = tools.find(t => t.name === selectedTool)?.input_schema

  useEffect(() => {
    if (apiKey) sessionStorage.setItem('st1_ai_tool_key', apiKey)
  }, [apiKey])

  async function loadTools() {
    setLoading(true)
    setError('')
    setDiscovery(null)
    try {
      const r = await fetch('/api/ai/tools?formats=true', {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      })
      const d = await r.json()
      if (!r.ok || d.ok === false) throw new Error(d.error?.message || `HTTP ${r.status}`)
      setDiscovery(d)
      const first = d.tools?.[0]?.name || selectedTool
      setSelectedTool(first)
      setInputText(JSON.stringify(TOOL_EXAMPLES[first] || {}, null, 2))
      await loadDocuments(apiKey.trim())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadDocuments(key = apiKey.trim()) {
    if (!key) return
    setDocsLoading(true)
    try {
      const r = await fetch('/api/ai/knowledge-docs', {
        headers: { Authorization: `Bearer ${key}` },
      })
      const d = await r.json()
      if (!r.ok || d.ok === false) throw new Error(d.error?.message || `HTTP ${r.status}`)
      setDocuments(d.documents || [])
    } catch (e) {
      setDocMessage(`Could not load documents: ${e.message}`)
    } finally {
      setDocsLoading(false)
    }
  }

  async function saveDocument({ title, sourceType, sourceName, content }) {
    setDocMessage('')
    const r = await fetch('/api/ai/knowledge-docs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, sourceType, sourceName, content }),
    })
    const d = await r.json()
    if (!r.ok || d.ok === false) throw new Error(d.error?.message || `HTTP ${r.status}`)
    setDocuments(prev => [d.document, ...prev.filter(doc => doc.id !== d.document.id)])
    setDocMessage(`Added "${d.document.title}" to ST1 knowledge.`)
  }

  async function uploadManualDoc() {
    if (!docTitle.trim() || !docContent.trim()) {
      setDocMessage('Add a title and content first.')
      return
    }
    try {
      await saveDocument({
        title: docTitle.trim(),
        sourceType: 'manual',
        sourceName: 'AI Knowledge Hub',
        content: docContent.trim(),
      })
      setDocTitle('')
      setDocContent('')
    } catch (e) {
      setDocMessage(e.message)
    }
  }

  async function uploadFile(file) {
    if (!file) return
    setDocMessage('')
    const allowed = /\.(txt|md|csv|json)$/i.test(file.name)
    if (!allowed) {
      setDocMessage('For now, upload .txt, .md, .csv, or .json files. PDF/Docx connectors are next.')
      return
    }
    try {
      const content = await file.text()
      await saveDocument({
        title: file.name.replace(/\.[^.]+$/, ''),
        sourceType: 'upload',
        sourceName: file.name,
        content,
      })
    } catch (e) {
      setDocMessage(e.message)
    }
  }

  async function deleteDocument(id) {
    setDocMessage('')
    try {
      const r = await fetch(`/api/ai/knowledge-docs?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      })
      const d = await r.json()
      if (!r.ok || d.ok === false) throw new Error(d.error?.message || `HTTP ${r.status}`)
      setDocuments(prev => prev.filter(doc => doc.id !== id))
      setDocMessage('Removed document from ST1 knowledge.')
    } catch (e) {
      setDocMessage(e.message)
    }
  }

  async function callTool() {
    setCalling(true)
    setError('')
    setCallResult(null)
    try {
      const input = JSON.parse(inputText || '{}')
      const r = await fetch('/api/ai/tools', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tool: selectedTool, input }),
      })
      const d = await r.json()
      setCallResult(d)
      if (!r.ok || d.ok === false) throw new Error(d.error?.message || `HTTP ${r.status}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setCalling(false)
    }
  }

  function chooseTool(name) {
    setSelectedTool(name)
    setInputText(JSON.stringify(TOOL_EXAMPLES[name] || {}, null, 2))
    setCallResult(null)
  }

  const curlExample = `curl "${window.location.origin}/api/ai/tools?formats=true" \\
  -H "Authorization: Bearer YOUR_KEY"`

  return (
    <div style={{ minHeight: '100%', background: embedded ? 'transparent' : B.pageBg, padding: embedded ? 0 : 28, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.orange, letterSpacing: 2, marginBottom: 6 }}>COMMAND CENTER HUB</div>
          <h1 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 24, color: B.black, margin: 0 }}>AI Knowledge Hub</h1>
          <p style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.muted, lineHeight: 1.6, maxWidth: 760, margin: '6px 0 0' }}>
            One place to see the ST1 AI tool layer, what is connected, what data is available, and where to add more content before building Claude, OpenAI, MCP, or custom agents.
          </p>
        </div>
        <StatusPill ok={Boolean(discovery?.ok)} label={discovery?.ok ? 'API CONNECTED' : 'PASTE KEY TO CONNECT'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 420px) 1fr', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <Label>CONNECT AI TOOL API</Label>
            <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted, lineHeight: 1.6, marginBottom: 10 }}>
              Paste the bearer key from Vercel. It is stored only in this browser session for testing.
            </div>
            <input
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              type="password"
              placeholder="ST1_AI_TOOL_API_KEY or ST1_AI_TOOL_KEY"
              style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, borderRadius: 6, padding: '9px 11px', fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text, marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={loadTools} disabled={!apiKey.trim() || loading} style={{ background: !apiKey.trim() || loading ? B.muted : B.orange, color: B.white, border: 'none', borderRadius: 6, padding: '9px 14px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, letterSpacing: .8 }}>
                {loading ? 'CONNECTING...' : 'LOAD TOOLS'}
              </button>
              <CopyButton text={curlExample} label="COPY CURL" />
            </div>
          </Card>

          <Card>
            <Label>LOCAL UPLOADED REVOPS DATA</Label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {localSummary.map(([label, count]) => (
                <div key={label} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 7, padding: 10 }}>
                  <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, color: count ? B.orange : B.muted }}>{count}</div>
                  <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1 }}>{label.toUpperCase()}</div>
                </div>
              ))}
              {!localSummary.length && (
                <div style={{ gridColumn: '1 / -1', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted, lineHeight: 1.6 }}>
                  No browser-saved RevOps state found yet.
                </div>
              )}
            </div>
          </Card>

          <Card>
            <Label>SERVER KNOWLEDGE DOCS</Label>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 22, color: documents.length ? B.orange : B.muted }}>{documents.length}</div>
              <button onClick={() => loadDocuments()} disabled={!apiKey.trim() || docsLoading} style={{ background: B.surface, border: `1px solid ${B.border}`, color: B.muted, borderRadius: 5, padding: '5px 10px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8 }}>
                {docsLoading ? 'LOADING' : 'REFRESH'}
              </button>
            </div>
            <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted, lineHeight: 1.5 }}>
              These are searchable by `search_st1_knowledge` in the `documents` domain.
            </div>
          </Card>

          <Card>
            <Label>SAFETY BOUNDARIES</Label>
            {[
              ['Read-only tools', discovery?.safety?.readOnly !== false],
              ['No arbitrary database access', discovery?.safety?.arbitraryDatabaseAccess === false || !discovery],
              ['No raw SQL exposed', discovery?.safety?.exposesRawSql === false || !discovery],
              ['No secrets exposed', discovery?.safety?.exposesSecrets === false || !discovery],
            ].map(([label, ok]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? B.green : B.red }} />
                {label}
              </div>
            ))}
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ background: B.redBg, border: `1px solid ${B.red}30`, color: B.red, borderRadius: 8, padding: '10px 14px', fontFamily: "'Lexend',sans-serif", fontSize: 12 }}>
              {error}
            </div>
          )}

          <Card>
            <Label>ADD KNOWLEDGE - NO TECHNICAL SETUP</Label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 9, marginBottom: 12 }}>
              {[
                ['Connect Notion', 'Paste pages and database docs into ST1 knowledge.', 'COMING NEXT'],
                ['Connect Google Drive', 'Bring in docs, sheets, and shared-drive knowledge.', 'COMING NEXT'],
                ['Upload a doc', 'Add text, markdown, CSV, or JSON now.', 'READY'],
              ].map(([title, desc, status]) => (
                <div key={title} style={{ background: status === 'READY' ? B.greenBg : B.surface, border: `1px solid ${status === 'READY' ? B.green : B.border}30`, borderRadius: 8, padding: 12 }}>
                  <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 13, color: B.black, marginBottom: 5 }}>{title}</div>
                  <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted, lineHeight: 1.45, minHeight: 30 }}>{desc}</div>
                  <div style={{ marginTop: 8, fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: status === 'READY' ? B.green : B.yellow, letterSpacing: 1 }}>{status}</div>
                </div>
              ))}
            </div>
            <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 14, color: B.black }}>Upload a doc</div>
                  <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted }}>Text, Markdown, CSV, and JSON files are available now.</div>
                </div>
                <label style={{ background: B.orange, color: B.white, borderRadius: 6, padding: '8px 12px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: .8, cursor: apiKey.trim() ? 'pointer' : 'not-allowed', opacity: apiKey.trim() ? 1 : .45 }}>
                  CHOOSE FILE
                  <input type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" disabled={!apiKey.trim()} onChange={e => uploadFile(e.target.files?.[0])} style={{ display: 'none' }} />
                </label>
              </div>
              <input value={docTitle} onChange={e => setDocTitle(e.target.value)} placeholder="Or paste a title..." style={{ width: '100%', background: B.white, border: `1px solid ${B.border}`, borderRadius: 6, padding: '8px 10px', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.text, marginBottom: 7 }} />
              <textarea value={docContent} onChange={e => setDocContent(e.target.value)} rows={5} placeholder="Paste policy notes, vendor terms, product notes, sales playbooks, etc." style={{ width: '100%', background: B.white, border: `1px solid ${B.border}`, borderRadius: 6, padding: '8px 10px', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.text, resize: 'vertical', marginBottom: 8 }} />
              <button onClick={uploadManualDoc} disabled={!apiKey.trim()} style={{ background: apiKey.trim() ? B.orange : B.muted, color: B.white, border: 'none', borderRadius: 6, padding: '8px 12px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: .8 }}>
                ADD TO KNOWLEDGE
              </button>
              {docMessage && <div style={{ marginTop: 8, fontFamily: "'Lexend',sans-serif", fontSize: 11, color: docMessage.startsWith('Added') || docMessage.startsWith('Removed') ? B.green : B.yellow, lineHeight: 1.45 }}>{docMessage}</div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {documents.slice(0, 8).map(doc => (
                <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: B.white, border: `1px solid ${B.border}`, borderRadius: 7, padding: '8px 10px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
                    <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted }}>{doc.sourceType} · {doc.charCount || 0} chars</div>
                  </div>
                  <button onClick={() => deleteDocument(doc.id)} disabled={!apiKey.trim()} style={{ background: 'none', border: 'none', color: B.muted, fontSize: 14, padding: 2 }}>x</button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <Label>AVAILABLE AI TOOLS</Label>
                <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted }}>
                  {tools.length ? `${tools.length} tools discovered for this key` : 'Load tools to inspect schemas and provider formats.'}
                </div>
              </div>
              {discovery?.totalRegisteredTools != null && <StatusPill ok label={`${discovery.totalRegisteredTools} REGISTERED`} />}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>
              {tools.map(tool => (
                <button key={tool.name} onClick={() => chooseTool(tool.name)} style={{ textAlign: 'left', background: selectedTool === tool.name ? B.orangeBg : B.surface, border: `1px solid ${selectedTool === tool.name ? B.orange : B.border}`, borderRadius: 8, padding: 11 }}>
                  <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: selectedTool === tool.name ? B.orange : B.text, letterSpacing: .8, marginBottom: 5 }}>{tool.name}</div>
                  <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted, lineHeight: 1.45 }}>{tool.description}</div>
                  <div style={{ marginTop: 7, fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.orange }}>{tool.permission}</div>
                </button>
              ))}
              {!tools.length && (
                <div style={{ gridColumn: '1 / -1', background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: 18, fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.muted }}>
                  Enter the AI tool key and click Load Tools.
                </div>
              )}
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Card>
              <Label>TEST A TOOL CALL</Label>
              <select value={selectedTool} onChange={e => chooseTool(e.target.value)} style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, borderRadius: 6, padding: '8px 10px', fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text, marginBottom: 8 }}>
                {Object.keys(TOOL_EXAMPLES).map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <textarea value={inputText} onChange={e => setInputText(e.target.value)} rows={9} style={{ width: '100%', background: '#111827', color: '#E5E7EB', border: 'none', borderRadius: 7, padding: 11, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5, resize: 'vertical' }} />
              <button onClick={callTool} disabled={!apiKey.trim() || calling} style={{ marginTop: 8, width: '100%', background: !apiKey.trim() || calling ? B.muted : B.orange, color: B.white, border: 'none', borderRadius: 6, padding: '10px 14px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, letterSpacing: .8 }}>
                {calling ? 'CALLING...' : 'CALL TOOL'}
              </button>
            </Card>

            <Card>
              <Label>SELECTED SCHEMA</Label>
              <pre style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 7, padding: 11, fontSize: 10, lineHeight: 1.5, color: B.text, overflowX: 'auto', maxHeight: 310 }}>
                {JSON.stringify(selectedSchema || { message: 'Load tools to inspect schema.' }, null, 2)}
              </pre>
            </Card>
          </div>

          {callResult && (
            <Card>
              <Label>TOOL RESULT</Label>
              <pre style={{ background: '#111827', color: '#E5E7EB', borderRadius: 7, padding: 12, fontSize: 10, lineHeight: 1.5, overflowX: 'auto', maxHeight: 380 }}>
                {JSON.stringify(callResult, null, 2)}
              </pre>
            </Card>
          )}

          <Card>
            <Label>WHERE TO ADD CONTENT</Label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
              {SOURCE_MAP.map(src => (
                <div key={src.name} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 13, color: B.black, marginBottom: 4 }}>{src.name}</div>
                  <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.orange, letterSpacing: 1, marginBottom: 7 }}>{src.owner.toUpperCase()}</div>
                  <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.text, lineHeight: 1.55, marginBottom: 7 }}>{src.content}</div>
                  <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted, lineHeight: 1.5 }}>{src.add}</div>
                </div>
              ))}
            </div>
          </Card>

          {discovery?.toolUseGuidance && (
            <Card>
              <Label>AGENT ROUTING GUIDANCE</Label>
              <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text, lineHeight: 1.6, marginBottom: 10 }}>{discovery.toolUseGuidance.principle}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 8 }}>
                {(discovery.toolUseGuidance.requiredToolUse || []).map(rule => (
                  <div key={`${rule.intent}-${rule.tool}`} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 7, padding: 10 }}>
                    <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.text, lineHeight: 1.45 }}>{rule.intent}</div>
                    <div style={{ marginTop: 5, fontFamily: 'monospace', fontSize: 10, color: B.orange }}>{rule.tool}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
