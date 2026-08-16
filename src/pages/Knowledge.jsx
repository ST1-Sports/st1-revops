import React, { useEffect, useMemo, useState } from 'react'

const B = {
  page: '#F2F2F0',
  white: '#fff',
  black: '#111111',
  text: '#1f2933',
  muted: '#6b7280',
  border: '#d9d9d4',
  surface: '#f8f8f6',
  orange: '#F37321',
  green: '#177245',
  red: '#C0392B',
  blue: '#2563eb',
}

const STATUS = ['UPLOADED', 'PROCESSING', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'FAILED']

function currentUserId() {
  try {
    return JSON.parse(localStorage.getItem('st1_revops_v2') || '{}').currentUserId || ''
  } catch {
    return ''
  }
}

async function knowledgeFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-st1-user-id': currentUserId(),
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

async function extractPdfText(file) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const parts = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    parts.push(`--- PAGE ${i} ---\n${content.items.map(item => item.str).join(' ')}`)
  }
  return parts.join('\n\n')
}

async function extractFileText(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return extractPdfText(file)
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
    return wb.SheetNames.map(sheetName => {
      return `--- SHEET ${sheetName} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[sheetName])}`
    }).join('\n\n')
  }
  return file.text()
}

function Card({ children, style = {} }) {
  return <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 12, padding: 18, ...style }}>{children}</div>
}

function Label({ children }) {
  return <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: 1.1, color: B.muted, marginBottom: 6, textTransform: 'uppercase' }}>{children}</div>
}

function Button({ children, onClick, disabled, tone = 'orange', style = {} }) {
  const color = tone === 'red' ? B.red : tone === 'green' ? B.green : tone === 'blue' ? B.blue : B.orange
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? B.border : color,
      color: disabled ? B.muted : '#fff',
      border: 'none',
      borderRadius: 6,
      padding: '9px 13px',
      fontFamily: "'Lexend Zetta',sans-serif",
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: .5,
      cursor: disabled ? 'not-allowed' : 'pointer',
      ...style,
    }}>{children}</button>
  )
}

const inputStyle = {
  width: '100%',
  border: `1px solid ${B.border}`,
  borderRadius: 6,
  padding: '10px 11px',
  fontFamily: "'Lexend',sans-serif",
  fontSize: 12,
  color: B.text,
  background: B.white,
}

export default function Knowledge() {
  const [sources, setSources] = useState([])
  const [sourceType, setSourceType] = useState('PASTED_TEXT')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [owner, setOwner] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [storageReference, setStorageReference] = useState('')
  const [content, setContent] = useState('')
  const [file, setFile] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const stats = useMemo(() => {
    const documents = sources.reduce((sum, source) => sum + (source.documents?.length || 0), 0)
    const chunks = sources.reduce((sum, source) => sum + (source.documents || []).reduce((s, doc) => s + (doc._count?.chunks || 0), 0), 0)
    const review = sources.filter(source => source.status === 'NEEDS_REVIEW').length
    return { sources: sources.length, documents, chunks, review }
  }, [sources])

  async function refresh() {
    const data = await knowledgeFetch('/api/knowledge?limit=50')
    setSources(data.sources || [])
  }

  useEffect(() => {
    refresh().catch(err => setError(err.message))
  }, [])

  async function ingest() {
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const payload = {
        sourceType,
        title,
        category,
        owner,
        sourceUrl: sourceType === 'URL' ? sourceUrl : '',
        storageReference: sourceType === 'GOOGLE_DRIVE' ? storageReference : '',
        content,
        processNow: true,
      }

      if (sourceType === 'FILE') {
        if (!file) throw new Error('Choose a file first')
        setMessage('Extracting file text for database storage...')
        payload.content = await extractFileText(file)
        payload.originalFilename = file.name
        payload.mimeType = file.type || null
        payload.uploadSize = file.size
        if (!payload.title) payload.title = file.name.replace(/\.[^.]+$/, '')
      }

      setMessage('Saving source, document, chunks, and import job...')
      const data = await knowledgeFetch('/api/knowledge', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setMessage(data.duplicate ? 'This source already exists in the database.' : 'Knowledge source saved and marked for review.')
      setTitle('')
      setCategory('')
      setOwner('')
      setSourceUrl('')
      setStorageReference('')
      setContent('')
      setFile(null)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(sourceId, status) {
    setError('')
    try {
      await knowledgeFetch(`/api/knowledge/${sourceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function processSource(sourceId) {
    setError('')
    setMessage('Processing source...')
    try {
      await knowledgeFetch('/api/knowledge/process', {
        method: 'POST',
        body: JSON.stringify({ sourceId }),
      })
      setMessage('Processing complete. Source is ready for review.')
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function search() {
    if (!query.trim()) return
    setError('')
    try {
      const data = await knowledgeFetch(`/api/knowledge/search?q=${encodeURIComponent(query)}&limit=20`)
      setResults(data)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: B.page, color: B.text, fontFamily: "'Lexend',sans-serif" }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 20px 48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
          <div>
            <a href="/" style={{ color: B.orange, fontSize: 11, textDecoration: 'none', fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: .5 }}>BACK TO REVOPS</a>
            <h1 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 28, margin: '8px 0 4px', letterSpacing: .2 }}>ST1 Knowledge</h1>
            <div style={{ color: B.muted, fontSize: 13 }}>Database-backed sources, documents, chunks, and import jobs.</div>
          </div>
          <Button tone="blue" onClick={refresh} disabled={loading}>REFRESH</Button>
        </div>

        {error && <div style={{ background: '#fff1f0', border: `1px solid ${B.red}55`, color: B.red, padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>{error}</div>}
        {message && <div style={{ background: '#effaf3', border: `1px solid ${B.green}55`, color: B.green, padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>{message}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          {[
            ['SOURCES', stats.sources],
            ['DOCUMENTS', stats.documents],
            ['CHUNKS', stats.chunks],
            ['NEEDS REVIEW', stats.review],
          ].map(([label, value]) => (
            <Card key={label} style={{ padding: 14 }}>
              <Label>{label}</Label>
              <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 24 }}>{value}</div>
            </Card>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 14, alignItems: 'start' }}>
          <Card>
            <h2 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, marginBottom: 12 }}>Create knowledge source</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <Label>Source type</Label>
                <select value={sourceType} onChange={e => setSourceType(e.target.value)} style={inputStyle}>
                  <option value="PASTED_TEXT">Pasted text</option>
                  <option value="FILE">File</option>
                  <option value="URL">URL</option>
                  <option value="GOOGLE_DRIVE">Google Drive</option>
                  <option value="MANUAL">Manual</option>
                </select>
              </div>
              <div>
                <Label>Title</Label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Source/document title" style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <Label>Category</Label>
                <input value={category} onChange={e => setCategory(e.target.value)} placeholder="policy, SOP, vendor, pricing, playbook..." style={inputStyle} />
              </div>
              <div>
                <Label>Owner</Label>
                <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="Optional owner" style={inputStyle} />
              </div>
            </div>

            {sourceType === 'URL' && (
              <div style={{ marginBottom: 12 }}>
                <Label>Source URL</Label>
                <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
              </div>
            )}

            {sourceType === 'GOOGLE_DRIVE' && (
              <div style={{ marginBottom: 12 }}>
                <Label>Google Drive reference</Label>
                <input value={storageReference} onChange={e => setStorageReference(e.target.value)} placeholder="Drive file URL or ID for future connector use" style={inputStyle} />
              </div>
            )}

            {sourceType === 'FILE' ? (
              <div>
                <Label>File</Label>
                <input type="file" accept=".pdf,.txt,.md,.csv,.json,.html,.xlsx,.xls" onChange={e => setFile(e.target.files?.[0] || null)} style={inputStyle} />
                <div style={{ color: B.muted, fontSize: 11, marginTop: 7 }}>The UI extracts text and stores that text in the database. Add object storage later if raw file retention is required.</div>
              </div>
            ) : sourceType !== 'URL' && sourceType !== 'GOOGLE_DRIVE' ? (
              <div>
                <Label>Content</Label>
                <textarea value={content} onChange={e => setContent(e.target.value)} rows={10} placeholder="Paste internal knowledge..." style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
              </div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <Button onClick={ingest} disabled={loading}>{loading ? 'WORKING...' : 'SAVE TO DATABASE'}</Button>
            </div>
          </Card>

          <Card>
            <h2 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, marginBottom: 12 }}>Search knowledge</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Search sources, documents, chunks..." style={inputStyle} />
              <Button tone="blue" onClick={search}>SEARCH</Button>
            </div>
            {results && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 620, overflow: 'auto' }}>
                {[...(results.documents || []), ...(results.chunks || []), ...(results.sources || [])].slice(0, 20).map(item => (
                  <div key={`${item.id}-${item.chunkIndex ?? ''}`} style={{ border: `1px solid ${B.border}`, borderRadius: 8, padding: 10, background: B.surface }}>
                    <div style={{ fontWeight: 700, fontSize: 12 }}>{item.title || item.document?.title}</div>
                    <div style={{ color: B.muted, fontSize: 11, marginTop: 3 }}>{item.category || item.sourceType || item.document?.source?.sourceType || 'chunk'}</div>
                    <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>{(item.summary || item.content || item.document?.summary || '').slice(0, 320)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card style={{ marginTop: 14 }}>
          <h2 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, marginBottom: 12 }}>Recent sources</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {sources.map(source => (
              <div key={source.id} style={{ border: `1px solid ${B.border}`, borderRadius: 9, padding: 12, background: B.surface }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{source.title}</div>
                    <div style={{ color: B.muted, fontSize: 11, marginTop: 3 }}>{source.sourceType}{source.originalFilename ? ` - ${source.originalFilename}` : ''}</div>
                  </div>
                  <div style={{ color: source.status === 'FAILED' ? B.red : source.status === 'APPROVED' ? B.green : B.orange, fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif" }}>{source.status}</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 12, marginTop: 10 }}>
                  <div>
                    {(source.documents || []).map(doc => (
                      <div key={doc.id} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{doc.title}</div>
                        <div style={{ color: B.muted, fontSize: 10 }}>{doc.category || 'uncategorized'} - {doc._count?.chunks || 0} chunks - {doc.status}</div>
                        {doc.summary && <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.45 }}>{doc.summary.slice(0, 280)}</div>}
                      </div>
                    ))}
                    {(source.importJobs || []).slice(0, 1).map(job => (
                      <div key={job.id} style={{ color: B.muted, fontSize: 10 }}>Latest job: {job.importType} - {job.status}</div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <Button tone="blue" onClick={() => processSource(source.id)}>PROCESS</Button>
                    {STATUS.filter(status => ['APPROVED', 'REJECTED', 'NEEDS_REVIEW'].includes(status)).map(status => (
                      <Button key={status} tone={status === 'APPROVED' ? 'green' : status === 'REJECTED' ? 'red' : 'orange'} onClick={() => updateStatus(source.id, status)}>
                        {status.replace('_', ' ')}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {!sources.length && <div style={{ color: B.muted, fontSize: 12 }}>No knowledge sources yet.</div>}
          </div>
        </Card>
      </div>
    </div>
  )
}
