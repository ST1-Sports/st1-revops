import React, { useState, useRef } from 'react'

const C = {
  bg:       '#F2F2F0',
  surface:  '#FFFFFF',
  border:   '#E5E5E3',
  orange:   '#F37321',
  dark:     '#1A1A1A',
  mid:      '#444',
  muted:    '#888',
  green:    '#16a34a',
  red:      '#dc2626',
  blue:     '#1A5FA8',
  reddit:   '#FF4500',
  orangeBg: '#FEF3EC',
  greenBg:  '#f0fdf4',
  purpleBg: '#f5f3ff',
  purple:   '#7c3aed',
}

const PRESET_TOPICS = [
  { id: "tf",    label: "Track & Field Equipment" },
  { id: "cc",    label: "Cross Country" },
  { id: "jump",  label: "Pole Vault / High Jump" },
  { id: "throw", label: "Throws — Javelin / Discus / Shot Put" },
  { id: "timing",label: "Timing Systems" },
  { id: "ad",    label: "Athletic Director Purchasing" },
  { id: "uni",   label: "Uniforms & Apparel" },
  { id: "rec",   label: "Equipment Recommendations" },
  { id: "budget",label: "School Sports Budget" },
  { id: "fund",  label: "Fundraising for Sports" },
]

function CopyBtn({ text, label = '⎘ COPY', successLabel = '✓ COPIED', style = {} }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }
  return (
    <button onClick={copy}
      style={{ background: copied ? C.green : C.orange, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .4, transition: 'background .2s', ...style }}>
      {copied ? successLabel : label}
    </button>
  )
}

function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function Reddit() {
  const [selectedTopics, setSelectedTopics] = useState(new Set(['tf', 'cc', 'ad']))
  const [customTopic,    setCustomTopic]    = useState('')
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState(null)
  const [result,         setResult]         = useState(null)   // { threads, searchedAt, topicsSearched }
  const [sel,            setSel]            = useState(null)   // selected thread
  const [detail,         setDetail]         = useState(null)   // reddit thread detail
  const [reply,          setReply]          = useState('')
  const replyRef = useRef(null)

  const toggleTopic = (id) => {
    setSelectedTopics(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const search = async () => {
    const topics = PRESET_TOPICS.filter(t => selectedTopics.has(t.id)).map(t => t.label)
    if (!topics.length && !customTopic.trim()) {
      setError('Select at least one topic before searching.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setSel(null)
    setDetail(null)
    try {
      const r = await fetch('/api/perplexity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics, customTopic: customTopic.trim() }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || 'Search failed')
      setResult(d)
      if (!d.threads.length) setError('No Reddit discussions found for these topics. Try different keywords or a broader search.')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const selectThread = (thread) => {
    setSel(thread)
    setReply(thread.suggestedReply)
    setDetail({ loading: true })
    fetch(`/api/reddit/thread-detail?url=${encodeURIComponent(thread.url)}`)
      .then(r => r.json())
      .then(d => setDetail({ ...d, loading: false }))
      .catch(e => setDetail({ loading: false, fetchError: e.message, body: '', topComments: [] }))
  }

  const openAndPaste = (url) => {
    navigator.clipboard?.writeText(reply).catch(() => {})
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Lexend', sans-serif", background: C.bg }}>

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <div style={{ width: 340, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.surface }}>

        {/* Header */}
        <div style={{ padding: '16px 18px 14px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 34, height: 34, background: C.reddit, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 14, flexShrink: 0 }}>r/</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.dark }}>Reddit Engagement</div>
              <div style={{ fontSize: 10, color: C.muted }}>Powered by Perplexity Search</div>
            </div>
          </div>

          {/* Topic chips */}
          <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, letterSpacing: .8, fontFamily: "'Lexend Zetta', sans-serif", marginBottom: 7 }}>SEARCH TOPICS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
            {PRESET_TOPICS.map(t => {
              const on = selectedTopics.has(t.id)
              return (
                <button key={t.id} onClick={() => toggleTopic(t.id)}
                  style={{ background: on ? C.orange : C.bg, color: on ? '#fff' : C.muted, border: `1px solid ${on ? C.orange : C.border}`, borderRadius: 20, padding: '4px 10px', fontSize: 10, fontFamily: "'Lexend', sans-serif", cursor: 'pointer', transition: 'all .15s' }}>
                  {t.label}
                </button>
              )
            })}
          </div>

          {/* Custom topic */}
          <input
            value={customTopic}
            onChange={e => setCustomTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Custom keyword (optional)…"
            style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', fontSize: 11, fontFamily: "'Lexend', sans-serif", color: C.dark, boxSizing: 'border-box', marginBottom: 10 }}
          />

          <button onClick={search} disabled={loading}
            style={{ width: '100%', background: loading ? C.muted : C.orange, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 0', fontSize: 12, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .5, transition: 'background .2s' }}>
            {loading ? '⏳ SEARCHING REDDIT…' : '🔍 SEARCH REDDIT'}
          </button>

          {result && !loading && (
            <div style={{ marginTop: 8, fontSize: 10, color: C.muted, textAlign: 'center' }}>
              {result.threads.length} thread{result.threads.length !== 1 ? 's' : ''} found · {fmtTime(result.searchedAt)}
            </div>
          )}
        </div>

        {/* Thread list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
          {error && (
            <div style={{ margin: '10px 4px', padding: 12, background: '#fef2f2', border: `1px solid ${C.red}40`, borderRadius: 7, fontSize: 11, color: C.red, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          {!result && !loading && !error && (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: C.muted, fontSize: 12, lineHeight: 1.7 }}>
              Select topics above and click<br /><strong style={{ color: C.orange }}>SEARCH REDDIT</strong><br />to find relevant discussions.
            </div>
          )}

          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: C.muted, fontSize: 12, lineHeight: 1.7 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🔍</div>
              Searching Reddit via Perplexity…<br />
              <span style={{ fontSize: 10 }}>This takes 10–20 seconds</span>
            </div>
          )}

          {result?.threads.map(t => {
            const active = sel?.id === t.id
            return (
              <button key={t.id} onClick={() => selectThread(t)}
                style={{ width: '100%', textAlign: 'left', display: 'block', background: active ? C.orangeBg : 'transparent', border: `1px solid ${active ? C.orange : C.border}`, borderRadius: 8, padding: '11px 13px', marginBottom: 7, cursor: 'pointer', transition: 'border-color .15s, background .15s' }}>
                <div style={{ fontSize: 9, color: C.reddit, fontWeight: 700, fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .5, marginBottom: 4 }}>
                  {t.subreddit}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.dark, lineHeight: 1.35, marginBottom: 5 }}>
                  {t.title}
                </div>
                {t.excerpt && (
                  <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {t.excerpt}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Right panel ──────────────────────────────────────────────────── */}
      {!sel ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: C.muted }}>
          <div style={{ fontSize: 36 }}>💬</div>
          <div style={{ fontSize: 14, color: C.mid }}>Select a thread to review and reply</div>
          <div style={{ fontSize: 12, color: C.muted }}>Perplexity drafts a reply — you edit and paste it into Reddit</div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Thread title bar */}
          <div style={{ padding: '16px 24px 12px', borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, justifyContent: 'space-between' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: C.reddit, fontWeight: 700, fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .5, marginBottom: 5 }}>
                  {sel.subreddit}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.dark, lineHeight: 1.3 }}>
                  {sel.title}
                </div>
              </div>
              <button onClick={() => openAndPaste(sel.url)}
                style={{ background: C.reddit, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .4, whiteSpace: 'nowrap', flexShrink: 0 }}>
                OPEN & PASTE ↗
              </button>
            </div>
            <div style={{ marginTop: 8, fontSize: 11 }}>
              <a href={sel.url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue, textDecoration: 'none', wordBreak: 'break-all' }}>
                {sel.url}
              </a>
            </div>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Thread context */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: .8, marginBottom: 10, fontFamily: "'Lexend Zetta', sans-serif" }}>
                THREAD CONTEXT
              </div>

              {/* Perplexity excerpt (always shown) */}
              {sel.excerpt && (
                <div style={{ background: C.purpleBg, border: `1px solid ${C.purple}30`, borderRadius: 8, padding: '12px 16px', marginBottom: 10 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.purple, letterSpacing: .5, marginBottom: 6, fontFamily: "'Lexend Zetta', sans-serif" }}>PERPLEXITY SUMMARY</div>
                  <div style={{ fontSize: 13, color: C.dark, lineHeight: 1.6 }}>{sel.excerpt}</div>
                </div>
              )}

              {detail?.loading && (
                <div style={{ fontSize: 12, color: C.muted, padding: '10px 0' }}>Loading Reddit thread…</div>
              )}

              {detail && !detail.loading && (
                <>
                  {detail.body ? (
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', marginBottom: 10, borderLeft: `3px solid ${C.reddit}` }}>
                      <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: .5, marginBottom: 8, fontFamily: "'Lexend Zetta', sans-serif" }}>ORIGINAL POST</div>
                      <div style={{ fontSize: 13, color: C.dark, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{detail.body}</div>
                    </div>
                  ) : detail.fetchError ? (
                    <div style={{ background: '#fef2f2', border: `1px solid ${C.red}40`, borderRadius: 6, padding: '10px 14px', fontSize: 11, color: C.red, marginBottom: 10 }}>
                      Could not load thread from Reddit — {detail.fetchError}.<br />
                      <span style={{ color: C.muted }}>The URL may have moved or the thread was deleted. Click "Open & Paste" to check.</span>
                    </div>
                  ) : (
                    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', marginBottom: 10, fontSize: 12, color: C.muted }}>
                      No post body (link post or removed). Click "Open &amp; Paste" to view on Reddit.
                    </div>
                  )}

                  {detail.topComments?.length > 0 && (
                    <>
                      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, letterSpacing: .5, marginBottom: 8, fontFamily: "'Lexend Zetta', sans-serif" }}>TOP COMMENTS</div>
                      {detail.topComments.map((c, i) => (
                        <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: '10px 14px', marginBottom: 8 }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: C.dark }}>u/{c.author}</span>
                            <span style={{ fontSize: 11, color: C.muted }}>↑ {c.score}</span>
                          </div>
                          <div style={{ fontSize: 12, color: C.mid, lineHeight: 1.6 }}>
                            {c.body.length > 500 ? c.body.slice(0, 500) + '…' : c.body}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Reply editor */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: .8, marginBottom: 10, fontFamily: "'Lexend Zetta', sans-serif" }}>
                YOUR REPLY
              </div>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px' }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
                  Drafted by Perplexity — edit freely before posting.
                </div>
                <textarea
                  ref={replyRef}
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  rows={9}
                  style={{ width: '100%', background: '#f9f9f7', border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 13px', fontSize: 13, fontFamily: "'Lexend', sans-serif", color: C.dark, resize: 'vertical', lineHeight: 1.65, boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <CopyBtn text={reply} label="⎘ COPY REPLY" successLabel="✓ COPIED" />
                  <button onClick={() => openAndPaste(sel.url)}
                    style={{ background: C.reddit, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .4 }}>
                    OPEN & PASTE ↗
                  </button>
                  <span style={{ fontSize: 11, color: C.muted, flex: 1, minWidth: 180 }}>
                    "Open & Paste" copies your reply and opens Reddit — Ctrl+V in the comment box.
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
