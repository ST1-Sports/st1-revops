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
  yellow: '#C77800',
}

const CATEGORIES = [
  'Pricing',
  'Product',
  'Vendor',
  'Brand',
  'Customer',
  'Policy',
  'SOP',
  'Sales',
  'Operations',
  'Finance',
  'Creative',
  'AI / Agent Instructions',
  'Other',
]

const ADD_OPTIONS = [
  { id: 'file', label: 'Upload File', sub: 'XLSX, CSV, PDF, DOCX, TXT', sourceType: 'FILE' },
  { id: 'paste', label: 'Paste Text', sub: 'Copy notes or docs directly', sourceType: 'PASTED_TEXT' },
  { id: 'url', label: 'Add URL', sub: 'Pull readable text from a web page', sourceType: 'URL' },
  { id: 'manual', label: 'Manual Entry', sub: 'Write a policy, SOP, or instruction', sourceType: 'MANUAL' },
]

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
    parts.push(`Page ${i}\n${content.items.map(item => item.str).join(' ')}`)
  }
  return parts.join('\n\n')
}

async function extractFileText(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return extractPdfText(file)
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth/mammoth.browser')
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return result.value || ''
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
    return wb.SheetNames.map(sheetName => {
      return `${sheetName}\n${XLSX.utils.sheet_to_csv(wb.Sheets[sheetName])}`
    }).join('\n\n')
  }
  return file.text()
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function sourceLabel(value) {
  return String(value || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function reviewLabel(status) {
  if (status === 'APPROVED') return 'Approved'
  if (status === 'REJECTED') return 'Rejected'
  if (status === 'NEEDS_REVIEW') return 'Ready for review'
  if (status === 'FAILED') return 'Failed'
  if (status === 'PROCESSING') return 'Processing'
  return 'Not reviewed'
}

function statusColor(status) {
  if (status === 'APPROVED') return B.green
  if (status === 'REJECTED' || status === 'FAILED') return B.red
  if (status === 'PROCESSING') return B.blue
  if (status === 'NEEDS_REVIEW') return B.orange
  return B.muted
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
      padding: '10px 15px',
      fontFamily: "'Lexend Zetta',sans-serif",
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: .5,
      cursor: disabled ? 'not-allowed' : 'pointer',
      ...style,
    }}>{children}</button>
  )
}

function StatusPill({ status }) {
  const color = statusColor(status)
  return (
    <span style={{
      color,
      background: `${color}10`,
      border: `1px solid ${color}35`,
      borderRadius: 999,
      padding: '3px 8px',
      fontSize: 9,
      fontFamily: "'Lexend Zetta',sans-serif",
      whiteSpace: 'nowrap',
    }}>{sourceLabel(status)}</span>
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

function emptyForm() {
  return {
    title: '',
    category: '',
    content: '',
    url: '',
    file: null,
    effectiveDate: '',
    expirationDate: '',
  }
}

export default function Knowledge() {
  const [sources, setSources] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [addMode, setAddMode] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [screen, setScreen] = useState('inbox')
  const [selectedSource, setSelectedSource] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const activity = useMemo(() => {
    return sources.map(source => {
      const doc = source.documents?.[0] || {}
      return {
        ...source,
        category: doc.category || 'Other',
        reviewStatus: reviewLabel(source.status),
      }
    })
  }, [sources])

  async function refresh() {
    const data = await knowledgeFetch('/api/knowledge?limit=50')
    setSources(data.sources || [])
  }

  useEffect(() => {
    refresh().catch(err => setError(err.message))
  }, [])

  function openAdd(mode = null) {
    setForm(emptyForm())
    setAddMode(mode)
    setError('')
    setMessage('')
    setShowAdd(true)
  }

  async function submitKnowledge() {
    const option = ADD_OPTIONS.find(item => item.id === addMode)
    if (!option) return

    setLoading(true)
    setError('')
    setMessage('')

    try {
      const payload = {
        sourceType: option.sourceType,
        title: form.title,
        category: form.category || 'Other',
        content: form.content,
        sourceUrl: addMode === 'url' ? form.url : '',
        effectiveDate: form.effectiveDate || null,
        expirationDate: form.expirationDate || null,
        processNow: true,
      }

      if (addMode === 'file') {
        if (!form.file) throw new Error('Choose a file first')
        setMessage('Reading file...')
        payload.content = await extractFileText(form.file)
        payload.originalFilename = form.file.name
        payload.mimeType = form.file.type || null
        payload.uploadSize = form.file.size
        if (!payload.title) payload.title = form.file.name.replace(/\.[^.]+$/, '')
      }

      if (addMode === 'paste' && (!payload.title || !payload.content)) {
        throw new Error('Title and pasted text are required')
      }
      if (addMode === 'manual' && (!payload.title || !payload.category || !payload.content)) {
        throw new Error('Title, category, and content are required')
      }
      if (addMode === 'url' && !payload.sourceUrl) {
        throw new Error('URL is required')
      }

      setMessage('Saving and processing...')
      const data = await knowledgeFetch('/api/knowledge', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const source = data.source || data?.source
      setShowAdd(false)
      setMessage(data.duplicate ? 'This knowledge already exists.' : 'Processing complete. Ready for review.')
      await refresh()
      if (source) {
        setSelectedSource(source)
        setScreen('review')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadReview(sourceId) {
    setError('')
    try {
      const data = await knowledgeFetch(`/api/knowledge/${sourceId}`)
      setSelectedSource(data.source)
      setScreen('review')
    } catch (err) {
      setError(err.message)
    }
  }

  async function updateStatus(status) {
    if (!selectedSource) return
    setLoading(true)
    setError('')
    try {
      const data = await knowledgeFetch(`/api/knowledge/${selectedSource.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      setSelectedSource(data.source)
      setMessage(status === 'APPROVED' ? 'Knowledge approved.' : status === 'REJECTED' ? 'Knowledge rejected.' : 'Status updated.')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const selectedDoc = selectedSource?.documents?.[0]
  const latestJob = selectedSource?.importJobs?.[0]
  const ingestion = latestJob?.proposedChanges?.documents?.[0]?.ingestion
  const proposedActions = latestJob?.proposedChanges?.proposed_database_actions || ingestion?.proposed_database_actions || []
  const rowsNeedingReview = ingestion?.rows_needing_review || []

  return (
    <div style={{ minHeight: '100vh', background: B.page, color: B.text, fontFamily: "'Lexend',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '28px 22px 48px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 18 }}>
          <div>
            <a href="/" style={{ color: B.orange, fontSize: 11, textDecoration: 'none', fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: .5 }}>BACK TO REVOPS</a>
            <h1 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 30, margin: '8px 0 3px', letterSpacing: .2 }}>ST1 KNOWLEDGE</h1>
            <div style={{ color: B.muted, fontSize: 13 }}>Keep important ST1 information organized, reviewed, and ready for future AI use.</div>
          </div>
          {screen === 'review' ? (
            <Button tone="blue" onClick={() => { setScreen('inbox'); setSelectedSource(null); }}>BACK TO INBOX</Button>
          ) : (
            <Button onClick={() => openAdd(null)}>ADD KNOWLEDGE</Button>
          )}
        </div>

        {error && <div style={{ background: '#fff1f0', border: `1px solid ${B.red}55`, color: B.red, padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>{error}</div>}
        {message && <div style={{ background: '#effaf3', border: `1px solid ${B.green}55`, color: B.green, padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>{message}</div>}

        {screen === 'inbox' && (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: `1px solid ${B.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 17 }}>Recent knowledge activity</div>
                <div style={{ color: B.muted, fontSize: 12, marginTop: 2 }}>Uploads, pasted knowledge, URLs, and manual entries.</div>
              </div>
              <Button onClick={() => openAdd(null)} style={{ padding: '8px 13px' }}>ADD KNOWLEDGE</Button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: B.surface, color: B.muted, fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: .7, textAlign: 'left' }}>
                    {['Title', 'Source Type', 'Category', 'Status', 'Uploaded By', 'Date', 'Review Status', ''].map(h => (
                      <th key={h} style={{ padding: '11px 12px', borderBottom: `1px solid ${B.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activity.map(item => (
                    <tr key={item.id} style={{ borderBottom: `1px solid ${B.border}` }}>
                      <td style={{ padding: '12px', fontWeight: 700, minWidth: 190 }}>{item.title}</td>
                      <td style={{ padding: '12px', color: B.muted }}>{sourceLabel(item.sourceType)}</td>
                      <td style={{ padding: '12px' }}>{item.category}</td>
                      <td style={{ padding: '12px' }}><StatusPill status={item.status} /></td>
                      <td style={{ padding: '12px', color: B.muted }}>{item.uploadedBy || 'Unknown'}</td>
                      <td style={{ padding: '12px', color: B.muted, whiteSpace: 'nowrap' }}>{formatDate(item.createdAt)}</td>
                      <td style={{ padding: '12px', color: statusColor(item.status), fontWeight: 700 }}>{item.reviewStatus}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <button onClick={() => loadReview(item.id)} style={{ background: 'none', border: `1px solid ${B.border}`, color: B.text, borderRadius: 5, padding: '6px 10px', fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", cursor: 'pointer' }}>
                          REVIEW
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!activity.length && (
                    <tr>
                      <td colSpan={8} style={{ padding: 36, textAlign: 'center', color: B.muted }}>
                        No knowledge added yet. Click Add Knowledge to start.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {screen === 'review' && selectedSource && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14, alignItems: 'start' }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <Label>Review knowledge</Label>
                  <h2 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 22, margin: 0 }}>{selectedSource.title}</h2>
                  <div style={{ color: B.muted, fontSize: 12, marginTop: 4 }}>
                    {sourceLabel(selectedSource.sourceType)} / {selectedDoc?.category || 'Other'} / uploaded {formatDate(selectedSource.createdAt)}
                  </div>
                </div>
                <StatusPill status={selectedSource.status} />
              </div>

              {selectedDoc?.summary && (
                <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <Label>Processing summary</Label>
                  <div style={{ fontSize: 12, lineHeight: 1.6 }}>{selectedDoc.summary}</div>
                </div>
              )}

              <Label>Content preview</Label>
              <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: 14, fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap', maxHeight: 460, overflow: 'auto' }}>
                {(selectedDoc?.content || '').slice(0, 8000) || 'No content available.'}
              </div>
            </Card>

            <Card>
              <Label>Review status</Label>
              <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 20, color: statusColor(selectedSource.status), marginBottom: 4 }}>
                {reviewLabel(selectedSource.status)}
              </div>
              <div style={{ color: B.muted, fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
                AI ingestion proposes changes only. Approving this item confirms the knowledge source; it does not overwrite product, pricing, customer, or vendor records.
              </div>

              <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: 11, marginBottom: 14 }}>
                <Label>Import activity</Label>
                <div style={{ fontSize: 12, color: B.text }}>{latestJob?.importType ? sourceLabel(latestJob.importType) : 'No job yet'}</div>
                <div style={{ fontSize: 11, color: B.muted, marginTop: 3 }}>{latestJob?.status ? reviewLabel(latestJob.status) : 'Waiting'}</div>
              </div>

              {ingestion && (
                <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: 11, marginBottom: 14 }}>
                  <Label>AI understanding</Label>
                  <div style={{ fontSize: 12, color: B.text, marginBottom: 4 }}>{sourceLabel(ingestion.detected_type)}</div>
                  <div style={{ fontSize: 11, color: B.muted }}>Confidence: {Math.round((ingestion.confidence || 0) * 100)}%</div>
                  {!!ingestion.extracted_entities && (
                    <div style={{ fontSize: 11, color: B.muted, marginTop: 8, lineHeight: 1.5 }}>
                      Brands: {(ingestion.extracted_entities.brands || []).slice(0, 4).join(', ') || '-'}<br/>
                      Vendors: {(ingestion.extracted_entities.vendors || []).slice(0, 4).join(', ') || '-'}<br/>
                      Customers: {(ingestion.extracted_entities.customers || []).slice(0, 4).join(', ') || '-'}
                    </div>
                  )}
                </div>
              )}

              {!!latestJob?.warnings?.length && (
                <div style={{ background: '#fff8e6', border: `1px solid ${B.yellow}55`, borderRadius: 8, padding: 11, marginBottom: 14 }}>
                  <Label>Needs attention</Label>
                  {(latestJob.warnings || []).slice(0, 5).map((warning, idx) => (
                    <div key={idx} style={{ color: B.yellow, fontSize: 11, lineHeight: 1.45, marginBottom: 4 }}>{warning}</div>
                  ))}
                </div>
              )}

              {!!proposedActions.length && (
                <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: 11, marginBottom: 14 }}>
                  <Label>Proposed changes</Label>
                  {proposedActions.slice(0, 5).map((action, idx) => (
                    <div key={idx} style={{ borderBottom: idx < Math.min(proposedActions.length, 5) - 1 ? `1px solid ${B.border}` : 'none', padding: '7px 0' }}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{sourceLabel(action.action)} / {sourceLabel(action.target)}</div>
                      <div style={{ color: B.muted, fontSize: 10, lineHeight: 1.4, marginTop: 2 }}>{action.rationale || 'Requires review before applying.'}</div>
                    </div>
                  ))}
                </div>
              )}

              {!!rowsNeedingReview.length && (
                <div style={{ background: '#fff1f0', border: `1px solid ${B.red}35`, borderRadius: 8, padding: 11, marginBottom: 14 }}>
                  <Label>Rows needing review</Label>
                  {rowsNeedingReview.slice(0, 4).map((row, idx) => (
                    <div key={idx} style={{ color: B.red, fontSize: 11, lineHeight: 1.45, marginBottom: 5 }}>
                      {row.source_row ? `${row.source_row}: ` : ''}{row.reason}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Button tone="green" disabled={loading} onClick={() => updateStatus('APPROVED')}>APPROVE</Button>
                <Button tone="red" disabled={loading} onClick={() => updateStatus('REJECTED')}>REJECT</Button>
                <Button tone="blue" disabled={loading} onClick={() => updateStatus('NEEDS_REVIEW')}>MARK NEEDS REVIEW</Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {showAdd && (
        <div onClick={() => !loading && setShowAdd(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: B.white, borderRadius: 14, boxShadow: '0 24px 90px rgba(0,0,0,.28)', width: '100%', maxWidth: 760, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ padding: '17px 20px', borderBottom: `1px solid ${B.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 20 }}>Add Knowledge</div>
                <div style={{ color: B.muted, fontSize: 12, marginTop: 2 }}>Choose the easiest way to add what you know.</div>
              </div>
              <button onClick={() => !loading && setShowAdd(false)} style={{ background: 'none', border: 'none', color: B.muted, fontSize: 18, cursor: 'pointer' }}>x</button>
            </div>

            <div style={{ padding: 20 }}>
              {!addMode ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {ADD_OPTIONS.map(option => (
                    <button key={option.id} onClick={() => setAddMode(option.id)} style={{ textAlign: 'left', background: B.surface, border: `1px solid ${B.border}`, borderRadius: 10, padding: 16, cursor: 'pointer' }}>
                      <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 16, color: B.black }}>{option.label}</div>
                      <div style={{ color: B.muted, fontSize: 12, marginTop: 5, lineHeight: 1.45 }}>{option.sub}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div>
                  <button onClick={() => setAddMode(null)} style={{ background: 'none', border: 'none', color: B.orange, fontSize: 11, fontFamily: "'Lexend Zetta',sans-serif", cursor: 'pointer', marginBottom: 14 }}>BACK</button>
                  <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, marginBottom: 14 }}>{ADD_OPTIONS.find(o => o.id === addMode)?.label}</div>

                  {addMode === 'file' && (
                    <div style={{ marginBottom: 12 }}>
                      <Label>File</Label>
                      <input type="file" accept=".xlsx,.xls,.csv,.pdf,.docx,.txt" onChange={e => setForm(f => ({ ...f, file: e.target.files?.[0] || null }))} style={inputStyle} />
                      <div style={{ color: B.muted, fontSize: 11, marginTop: 6 }}>Supported now: XLSX, CSV, PDF, DOCX, TXT.</div>
                    </div>
                  )}

                  {addMode !== 'url' && (
                    <div style={{ marginBottom: 12 }}>
                      <Label>Title</Label>
                      <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="What should this be called?" style={inputStyle} />
                    </div>
                  )}

                  {addMode === 'url' && (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <Label>URL</Label>
                        <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://..." style={inputStyle} />
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <Label>Optional title</Label>
                        <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Leave blank to use the URL" style={inputStyle} />
                      </div>
                    </>
                  )}

                  <div style={{ marginBottom: 12 }}>
                    <Label>{addMode === 'manual' ? 'Category' : 'Optional category'}</Label>
                    <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                      <option value="">Choose category</option>
                      {CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </div>

                  {(addMode === 'paste' || addMode === 'manual') && (
                    <div style={{ marginBottom: 12 }}>
                      <Label>Content</Label>
                      <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} rows={addMode === 'manual' ? 9 : 11} placeholder="Add the knowledge here..." style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
                    </div>
                  )}

                  {addMode === 'manual' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <Label>Effective date</Label>
                        <input type="date" value={form.effectiveDate} onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} style={inputStyle} />
                      </div>
                      <div>
                        <Label>Expiration date if applicable</Label>
                        <input type="date" value={form.expirationDate} onChange={e => setForm(f => ({ ...f, expirationDate: e.target.value }))} style={inputStyle} />
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                    <button onClick={() => setShowAdd(false)} disabled={loading} style={{ background: B.white, border: `1px solid ${B.border}`, color: B.muted, borderRadius: 6, padding: '10px 15px', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                    <Button onClick={submitKnowledge} disabled={loading}>{loading ? 'ADDING...' : 'ADD KNOWLEDGE'}</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
