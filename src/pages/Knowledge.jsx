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

function currentUserId() {
  try {
    const state = JSON.parse(localStorage.getItem('st1_revops_v2') || '{}')
    return state.currentUserId || ''
  } catch {
    return ''
  }
}

async function knowledgeFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-st1-user-id': currentUserId(),
    ...(options.headers || {}),
  }
  const res = await fetch(path, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

async function extractPdfText(file) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).href
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  const parts = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    parts.push(`--- PAGE ${pageNum} ---\n${content.items.map(item => item.str).join(' ')}`)
  }
  return parts.join('\n\n')
}

async function extractFileText(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return extractPdfText(file)
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
    return wb.SheetNames.map(sheetName => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName])
      return `--- SHEET ${sheetName} ---\n${csv}`
    }).join('\n\n')
  }
  return file.text()
}

function Card({ children, style = {} }) {
  return <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 12, padding: 18, ...style }}>{children}</div>
}

function Label({ children }) {
  return <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: 1.2, color: B.muted, marginBottom: 6, textTransform: 'uppercase' }}>{children}</div>
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

function Field({ label, children }) {
  return <div><Label>{label}</Label>{children}</div>
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
  const [documents, setDocuments] = useState([])
  const [pending, setPending] = useState([])
  const [sourceType, setSourceType] = useState('PASTE')
  const [title, setTitle] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState(null)

  const stats = useMemo(() => ({
    docs: documents.length,
    review: pending.length,
    facts: documents.reduce((sum, doc) => sum + (doc._count?.facts || 0), 0),
  }), [documents, pending])

  async function refresh() {
    const [docs, review] = await Promise.all([
      knowledgeFetch('/api/knowledge?limit=50'),
      knowledgeFetch('/api/knowledge/review?status=PENDING&limit=100'),
    ])
    setDocuments(docs.documents || [])
    setPending(review.extractions || [])
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
        sourceUrl: sourceType === 'URL' ? sourceUrl : '',
        text: sourceType === 'PASTE' || sourceType === 'MANUAL' ? text : '',
        processNow: true,
      }

      if (sourceType === 'FILE') {
        if (!file) throw new Error('Choose a file first')
        setMessage('Extracting file text...')
        payload.text = await extractFileText(file)
        payload.fileName = file.name
        payload.mimeType = file.type || null
        payload.uploadSize = file.size
        if (!payload.title) payload.title = file.name.replace(/\.[^.]+$/, '')
      }

      setMessage('Saving to database and running AI extraction...')
      const data = await knowledgeFetch('/api/knowledge', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (data.processingError) {
        setMessage(`Saved to DB, but AI processing failed: ${data.processingError}`)
      } else {
        setMessage(data.duplicate ? 'Already in knowledge database.' : 'Saved to DB and queued for review.')
      }
      setTitle('')
      setText('')
      setFile(null)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function reviewExtraction(extractionId, action) {
    setError('')
    try {
      await knowledgeFetch('/api/knowledge/review', {
        method: 'POST',
        body: JSON.stringify({ extractionId, action }),
      })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function search() {
    if (!query.trim()) return
    setError('')
    try {
      const data = await knowledgeFetch(`/api/knowledge/search?q=${encodeURIComponent(query)}&limit=10`)
      setSearchResults(data)
    } catch (err) {
      setError(err.message)
    }
  }

  async function ask() {
    if (!question.trim()) return
    setError('')
    setAnswer(null)
    try {
      const data = await knowledgeFetch('/api/knowledge/ask', {
        method: 'POST',
        body: JSON.stringify({ query: question, limit: 8 }),
      })
      setAnswer(data)
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
            <div style={{ color: B.muted, fontSize: 13 }}>DB-backed ingestion, AI extraction, human review, and internal search.</div>
          </div>
          <Button tone="blue" onClick={refresh} disabled={loading}>REFRESH</Button>
        </div>

        {error && <div style={{ background: '#fff1f0', border: `1px solid ${B.red}55`, color: B.red, padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>{error}</div>}
        {message && <div style={{ background: '#effaf3', border: `1px solid ${B.green}55`, color: B.green, padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>{message}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
          {[
            ['DOCUMENTS', stats.docs],
            ['PENDING REVIEW', stats.review],
            ['APPROVED FACTS', stats.facts],
          ].map(([label, value]) => (
            <Card key={label} style={{ padding: 14 }}>
              <Label>{label}</Label>
              <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 24 }}>{value}</div>
            </Card>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 14, alignItems: 'start' }}>
          <Card>
            <h2 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, marginBottom: 12 }}>Ingest knowledge</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, marginBottom: 12 }}>
              <Field label="Source type">
                <select value={sourceType} onChange={e => setSourceType(e.target.value)} style={inputStyle}>
                  <option value="PASTE">Paste text</option>
                  <option value="URL">URL</option>
                  <option value="FILE">File</option>
                  <option value="MANUAL">Manual note</option>
                </select>
              </Field>
              <Field label="Title">
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Optional title" style={inputStyle} />
              </Field>
            </div>

            {sourceType === 'URL' && (
              <Field label="URL">
                <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
              </Field>
            )}

            {(sourceType === 'PASTE' || sourceType === 'MANUAL') && (
              <Field label="Content">
                <textarea value={text} onChange={e => setText(e.target.value)} rows={10} placeholder="Paste supplier notes, product details, competitor intel, customer info, pricing context..." style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
              </Field>
            )}

            {sourceType === 'FILE' && (
              <Field label="File">
                <input type="file" accept=".pdf,.txt,.md,.csv,.json,.html,.xlsx,.xls" onChange={e => setFile(e.target.files?.[0] || null)} style={inputStyle} />
                <div style={{ color: B.muted, fontSize: 11, marginTop: 7 }}>PDF, text, CSV, HTML, JSON, Excel. Extracted text is sent to the database; the raw binary file is not kept locally.</div>
              </Field>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <Button onClick={ingest} disabled={loading}>{loading ? 'WORKING...' : 'SAVE TO DB + PROCESS'}</Button>
            </div>
          </Card>

          <Card>
            <h2 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, marginBottom: 12 }}>Internal search</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Search products, vendors, pricing, customers..." style={inputStyle} />
              <Button tone="blue" onClick={search}>SEARCH</Button>
            </div>
            {searchResults && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 310, overflow: 'auto' }}>
                {[...(searchResults.facts || []), ...(searchResults.chunks || [])].slice(0, 8).map(item => (
                  <div key={item.id} style={{ border: `1px solid ${B.border}`, borderRadius: 8, padding: 10, background: B.surface }}>
                    <div style={{ fontWeight: 700, fontSize: 12 }}>{item.entityName || item.document?.title || item.title}</div>
                    <div style={{ color: B.muted, fontSize: 11, marginTop: 3 }}>{item.factType || item.document?.sourceType || 'chunk'}</div>
                    <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>{item.sourceQuote || item.content?.slice(0, 260) || JSON.stringify(item.value)}</div>
                  </div>
                ))}
              </div>
            )}

            <h2 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, margin: '18px 0 12px' }}>Ask knowledge</h2>
            <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={3} placeholder="Ask a question answered from approved facts and documents..." style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Button tone="blue" onClick={ask}>ASK</Button>
            </div>
            {answer && (
              <div style={{ marginTop: 12, border: `1px solid ${B.border}`, borderRadius: 8, padding: 12, background: B.surface }}>
                <div style={{ fontSize: 12, lineHeight: 1.55 }}>{answer.answer}</div>
                {!!answer.citations?.length && <div style={{ marginTop: 8, color: B.muted, fontSize: 10 }}>Citations: {answer.citations.map(c => c.title || c.documentId).join(', ')}</div>}
              </div>
            )}
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14, alignItems: 'start' }}>
          <Card>
            <h2 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, marginBottom: 12 }}>Human review queue</h2>
            {!pending.length && <div style={{ color: B.muted, fontSize: 12 }}>No pending extractions.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pending.map(extraction => (
                <div key={extraction.id} style={{ border: `1px solid ${B.border}`, borderRadius: 9, padding: 12, background: B.surface }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{extraction.entityName || 'Unknown entity'}</div>
                      <div style={{ color: B.muted, fontSize: 11, marginTop: 2 }}>{extraction.entityType} / {extraction.factType || 'general'} from {extraction.document?.title}</div>
                    </div>
                    <div style={{ color: B.muted, fontSize: 11 }}>{extraction.confidence != null ? `${Math.round(extraction.confidence * 100)}%` : ''}</div>
                  </div>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: '9px 0', fontSize: 11, lineHeight: 1.45, color: B.text, fontFamily: "'Lexend',sans-serif" }}>{JSON.stringify(extraction.payload?.value ?? extraction.payload, null, 2)}</pre>
                  {extraction.payload?.sourceQuote && <div style={{ borderLeft: `3px solid ${B.orange}`, paddingLeft: 8, color: B.muted, fontSize: 11, lineHeight: 1.45 }}>{extraction.payload.sourceQuote}</div>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                    <Button tone="red" onClick={() => reviewExtraction(extraction.id, 'reject')}>REJECT</Button>
                    <Button tone="green" onClick={() => reviewExtraction(extraction.id, 'approve')}>APPROVE FACT</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, marginBottom: 12 }}>Recent DB documents</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 620, overflow: 'auto' }}>
              {documents.map(doc => (
                <div key={doc.id} style={{ border: `1px solid ${B.border}`, borderRadius: 8, padding: 10, background: B.surface }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 12 }}>{doc.title}</div>
                    <div style={{ color: doc.status === 'ERROR' ? B.red : doc.status === 'APPROVED' ? B.green : B.orange, fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif" }}>{doc.status}</div>
                  </div>
                  <div style={{ color: B.muted, fontSize: 11, marginTop: 4 }}>{doc.sourceType}{doc.fileName ? ` - ${doc.fileName}` : ''}</div>
                  {doc.summary && <div style={{ fontSize: 11, lineHeight: 1.45, marginTop: 7 }}>{doc.summary}</div>}
                  {doc.error && <div style={{ color: B.red, fontSize: 11, marginTop: 7 }}>{doc.error}</div>}
                  <div style={{ color: B.muted, fontSize: 10, marginTop: 7 }}>{doc._count?.chunks || 0} chunks - {doc._count?.extractions || 0} extractions - {doc._count?.facts || 0} facts</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
