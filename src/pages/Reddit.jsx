import React, { useState, useEffect, useCallback } from 'react'

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
  blueBg:   '#eff6ff',
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function scoreColor(n) {
  if (!n) return C.muted
  if (n >= 8)  return C.green
  if (n >= 5)  return C.orange
  return C.red
}

function intentLabel(intent) {
  const map = {
    buying_now:          '💰 Buying Now',
    researching:         '🔍 Researching',
    general_discussion:  '💬 Discussion',
    support_request:     '🙋 Support',
    off_topic:           '↗ Off-Topic',
  }
  return map[intent] || intent || ''
}

function audienceLabel(aud) {
  const map = {
    coach: '🏃 Coach', parent: '👨 Parent', athlete: '🎽 Athlete',
    admin: '🏫 Admin/AD', unknown: '❓ Unknown',
  }
  return map[aud] || aud || ''
}

function statusBadge(status) {
  const s = {
    PENDING:   { label: 'Pending',   bg: '#f3f4f6', color: C.muted },
    EVALUATED: { label: 'Evaluated', bg: '#fffbeb', color: '#b45309' },
    NOTIFIED:  { label: 'Notified',  bg: C.blueBg,  color: C.blue },
    APPROVED:  { label: 'Approved',  bg: C.greenBg, color: C.green },
    REJECTED:  { label: 'Rejected',  bg: '#fef2f2', color: C.red },
    POSTED:    { label: 'Posted ✓',  bg: C.greenBg, color: C.green },
    SKIPPED:   { label: 'Skipped',   bg: '#f3f4f6', color: C.muted },
  }
  const d = s[status] || { label: status, bg: '#f3f4f6', color: C.muted }
  return (
    <span style={{ background: d.bg, color: d.color, borderRadius: 4, padding: '2px 7px',
      fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: .4, whiteSpace: 'nowrap' }}>
      {d.label}
    </span>
  )
}

function CopyBtn({ text, label = '⎘ Copy', style = {} }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => {
      navigator.clipboard?.writeText(text).catch(() => {})
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    }} style={{ background: copied ? C.green : C.surface, color: copied ? '#fff' : C.mid,
      border: `1px solid ${copied ? C.green : C.border}`, borderRadius: 4, padding: '6px 12px',
      fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", cursor: 'pointer', ...style }}>
      {copied ? '✓ Copied' : label}
    </button>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function Reddit() {
  const [threads,   setThreads]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [scanning,  setScanning]  = useState(false)
  const [scanMsg,   setScanMsg]   = useState('')
  const [sel,       setSel]       = useState(null)   // selected thread
  const [variant,   setVariant]   = useState(1)      // 1 or 2
  const [filter,    setFilter]    = useState('review') // review | all | posted | rejected
  const [marking,   setMarking]   = useState(null) // threadId being marked
  const [actErr,    setActErr]    = useState(null)

  // ── load threads from DB ────────────────────────────────────────────────────
  const loadThreads = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/reddit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'threads', limit: 100 }),
      })
      const d = await r.json()
      const list = d.threads || []
      setThreads(list)
      // Auto-select first actionable thread
      const first = list.find(t => t.replies?.length && !['POSTED','REJECTED','SKIPPED'].includes(t.status))
      if (first && !sel) setSel(first)
    } catch (e) {
      console.error('[Reddit] load error:', e)
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadThreads() }, [loadThreads])

  // When threads reload, keep selection current
  useEffect(() => {
    if (sel) {
      const updated = threads.find(t => t.id === sel.id)
      if (updated) setSel(updated)
    }
  }, [threads]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── run pipeline ────────────────────────────────────────────────────────────
  const runPipeline = async () => {
    setScanning(true)
    setScanMsg('Claude is searching Reddit and evaluating opportunities…')
    try {
      const r = await fetch('/api/reddit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pipeline' }),
      })
      const d = await r.json()
      const msg = d.ok
        ? `Found ${d.ingested} new threads · Evaluated ${d.evaluated} · ${d.generated} ready to review`
        : (d.error || 'Pipeline ran with errors')
      setScanMsg(msg)
      await loadThreads()
    } catch (e) {
      setScanMsg('Error: ' + e.message)
    } finally {
      setScanning(false)
    }
  }

  // ── actions ─────────────────────────────────────────────────────────────────
  const api = async (body) => {
    const r = await fetch('/api/reddit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return r.json()
  }

  const markDone = async (threadId) => {
    setMarking(threadId); setActErr(null)
    try {
      await api({ action: 'mark-done', threadId })
      await loadThreads()
    } catch (e) { setActErr(e.message) }
    setMarking(null)
  }

  const skip = async (threadId) => {
    setMarking(threadId); setActErr(null)
    try {
      await api({ action: 'reject', threadId })
      await loadThreads()
    } catch (e) { setActErr(e.message) }
    setMarking(null)
  }

  // ── derived lists ────────────────────────────────────────────────────────────
  const reviewable = threads.filter(t =>
    t.replies?.length > 0 && !['POSTED','REJECTED','SKIPPED','APPROVED'].includes(t.status)
  )
  const posted   = threads.filter(t => t.status === 'POSTED')
  const rejected = threads.filter(t => t.status === 'REJECTED' || t.status === 'SKIPPED')
  const pending  = threads.filter(t => t.status === 'PENDING' || (t.status === 'EVALUATED' && !t.replies?.length))

  const visibleList = filter === 'review'   ? reviewable
                    : filter === 'posted'   ? posted
                    : filter === 'rejected' ? rejected
                    : threads

  const lastScanTime = threads[0]?.ingestedAt
  const selReply = sel?.replies?.find(r => r.variant === variant) || sel?.replies?.[0]

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden',
      fontFamily: "'Lexend',sans-serif", background: C.bg }}>

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div style={{ width: 360, flexShrink: 0, borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.surface }}>

        {/* Header */}
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 32, height: 32, background: C.reddit, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 900, fontSize: 13, flexShrink: 0 }}>r/</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.dark }}>Reddit Opportunities</div>
              <div style={{ fontSize: 10, color: C.muted }}>
                {lastScanTime ? `Last scan: ${fmtDate(lastScanTime)}` : 'No scans yet'}
              </div>
            </div>
            <button onClick={runPipeline} disabled={scanning}
              style={{ background: scanning ? C.muted : C.orange, color: '#fff', border: 'none',
                borderRadius: 5, padding: '6px 12px', fontSize: 9, fontWeight: 700, cursor: scanning ? 'not-allowed' : 'pointer',
                fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: .3, whiteSpace: 'nowrap' }}>
              {scanning ? '⟳ Scanning…' : '⟳ Scan Now'}
            </button>
          </div>

          {scanMsg && (
            <div style={{ fontSize: 10, color: C.blue, background: C.blueBg, borderRadius: 4,
              padding: '5px 9px', marginBottom: 8 }}>{scanMsg}</div>
          )}

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {[
              { label: 'To Review', count: reviewable.length, key: 'review', color: C.orange },
              { label: 'All',       count: threads.length,    key: 'all',    color: C.muted },
              { label: 'Posted',    count: posted.length,     key: 'posted', color: C.green },
              { label: 'Skipped',   count: rejected.length,   key: 'rejected', color: C.muted },
            ].map(({ label, count, key, color }) => (
              <button key={key} onClick={() => setFilter(key)}
                style={{ background: filter === key ? (key === 'review' ? C.orangeBg : C.bg) : 'transparent',
                  border: `1px solid ${filter === key ? C.orange : C.border}`, borderRadius: 4,
                  padding: '4px 9px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif",
                  color: filter === key ? C.dark : C.muted, cursor: 'pointer', letterSpacing: .3 }}>
                {label} <span style={{ color }}>{count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Thread list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: 20, textAlign: 'center', color: C.muted, fontSize: 11 }}>
              Loading…
            </div>
          )}
          {!loading && visibleList.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: C.muted, fontSize: 11 }}>
              {filter === 'review'
                ? 'No threads ready to review. Click "Scan Now" to find opportunities.'
                : 'Nothing here yet.'}
            </div>
          )}
          {visibleList.map(thread => {
            const ev = thread.evaluation || {}
            const isSel = sel?.id === thread.id
            const hasReplies = thread.replies?.length > 0
            return (
              <div key={thread.id} onClick={() => { setSel(thread); setVariant(1); setActErr(null) }}
                style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
                  background: isSel ? C.orangeBg : C.surface,
                  borderLeft: `3px solid ${isSel ? C.orange : 'transparent'}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 9, color: C.reddit, fontWeight: 700, whiteSpace: 'nowrap',
                    fontFamily: "'Lexend Zetta',sans-serif" }}>r/{thread.subreddit}</span>
                  <div style={{ flex: 1 }} />
                  {statusBadge(thread.status)}
                </div>
                <div style={{ fontSize: 11, color: C.dark, fontWeight: 600, lineHeight: 1.35,
                  marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {thread.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {ev.fit_score != null && (
                    <span style={{ fontSize: 9, color: scoreColor(ev.fit_score),
                      fontFamily: "'Lexend Zetta',sans-serif" }}>
                      ★ {ev.fit_score}/10
                    </span>
                  )}
                  {ev.intent_type && (
                    <span style={{ fontSize: 9, color: C.muted }}>{intentLabel(ev.intent_type)}</span>
                  )}
                  <span style={{ fontSize: 9, color: C.muted, marginLeft: 'auto' }}>
                    {fmtDate(thread.ingestedAt)}
                  </span>
                  {hasReplies && (
                    <span style={{ fontSize: 8, color: C.orange, fontFamily: "'Lexend Zetta',sans-serif",
                      background: C.orangeBg, padding: '1px 5px', borderRadius: 3 }}>
                      REPLY READY
                    </span>
                  )}
                </div>
              </div>
            )
          })}

          {/* Pending threads note */}
          {filter === 'all' && pending.length > 0 && (
            <div style={{ padding: '10px 14px', background: '#fffbeb', borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, color: '#b45309' }}>
                ⏳ {pending.length} thread{pending.length !== 1 ? 's' : ''} still being evaluated by Claude.
                Click "Scan Now" to process them.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24, minWidth: 0 }}>
        {!sel ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 40, opacity: .15 }}>r/</div>
            <div style={{ fontSize: 14, color: C.muted, textAlign: 'center', maxWidth: 340 }}>
              {threads.length === 0
                ? 'Click "Scan Now" — Claude will search Reddit, score each thread, and write reply drafts for your review.'
                : 'Select a thread from the left to review Claude\'s reply recommendation.'}
            </div>
            {threads.length === 0 && (
              <button onClick={runPipeline} disabled={scanning}
                style={{ background: C.orange, color: '#fff', border: 'none', borderRadius: 6,
                  padding: '10px 22px', fontSize: 12, fontWeight: 700, cursor: scanning ? 'not-allowed' : 'pointer',
                  fontFamily: "'Lexend Zetta',sans-serif" }}>
                {scanning ? '⟳ Scanning…' : '⟳ Scan Reddit Now'}
              </button>
            )}
          </div>
        ) : (
          <div style={{ maxWidth: 720 }}>

            {/* Thread card */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: C.reddit, fontWeight: 700,
                  fontFamily: "'Lexend Zetta',sans-serif" }}>r/{sel.subreddit}</span>
                <span style={{ fontSize: 10, color: C.muted }}>by u/{sel.author}</span>
                <span style={{ fontSize: 10, color: C.muted }}>·</span>
                <span style={{ fontSize: 10, color: C.muted }}>⬆ {sel.score} · 💬 {sel.commentCount}</span>
                <span style={{ marginLeft: 'auto' }}>{statusBadge(sel.status)}</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.dark, marginBottom: 8, lineHeight: 1.4 }}>
                {sel.title}
              </div>
              {sel.body && (
                <div style={{ fontSize: 12, color: C.mid, lineHeight: 1.6, marginBottom: 8,
                  maxHeight: 80, overflow: 'hidden', WebkitLineClamp: 4,
                  display: '-webkit-box', WebkitBoxOrient: 'vertical' }}>
                  {sel.body}
                </div>
              )}
              <a href={sel.url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 10, color: C.blue, textDecoration: 'none' }}>
                ↗ Open on Reddit
              </a>
            </div>

            {/* Claude's evaluation */}
            {sel.evaluation && (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '14px 20px', marginBottom: 16 }}>
                <div style={{ fontSize: 9, color: C.muted, fontFamily: "'Lexend Zetta',sans-serif",
                  letterSpacing: .5, marginBottom: 10 }}>CLAUDE'S EVALUATION</div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 8, color: C.muted, fontFamily: "'Lexend Zetta',sans-serif",
                      letterSpacing: .4, marginBottom: 2 }}>FIT SCORE</div>
                    <div style={{ fontSize: 22, fontWeight: 800,
                      color: scoreColor(sel.evaluation.fit_score) }}>
                      {sel.evaluation.fit_score}<span style={{ fontSize: 12, color: C.muted }}>/10</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 8, color: C.muted, fontFamily: "'Lexend Zetta',sans-serif",
                      letterSpacing: .4, marginBottom: 2 }}>DECISION</div>
                    <div style={{ fontSize: 13, fontWeight: 700,
                      color: sel.evaluation.decision === 'REPLY' ? C.green
                           : sel.evaluation.decision === 'SKIP' ? C.red : C.orange }}>
                      {sel.evaluation.decision}
                    </div>
                  </div>
                  {sel.evaluation.intent_type && (
                    <div>
                      <div style={{ fontSize: 8, color: C.muted, fontFamily: "'Lexend Zetta',sans-serif",
                        letterSpacing: .4, marginBottom: 2 }}>INTENT</div>
                      <div style={{ fontSize: 12, color: C.dark }}>{intentLabel(sel.evaluation.intent_type)}</div>
                    </div>
                  )}
                  {sel.evaluation.audience_type && (
                    <div>
                      <div style={{ fontSize: 8, color: C.muted, fontFamily: "'Lexend Zetta',sans-serif",
                        letterSpacing: .4, marginBottom: 2 }}>AUDIENCE</div>
                      <div style={{ fontSize: 12, color: C.dark }}>{audienceLabel(sel.evaluation.audience_type)}</div>
                    </div>
                  )}
                  {sel.evaluation.promo_risk != null && (
                    <div>
                      <div style={{ fontSize: 8, color: C.muted, fontFamily: "'Lexend Zetta',sans-serif",
                        letterSpacing: .4, marginBottom: 2 }}>PROMO RISK</div>
                      <div style={{ fontSize: 13, fontWeight: 700,
                        color: sel.evaluation.promo_risk >= 7 ? C.red
                             : sel.evaluation.promo_risk >= 4 ? C.orange : C.green }}>
                        {sel.evaluation.promo_risk}/10
                      </div>
                    </div>
                  )}
                </div>
                {sel.evaluation.reasoning_summary && (
                  <div style={{ fontSize: 11, color: C.mid, lineHeight: 1.6, marginBottom: 6,
                    borderLeft: `3px solid ${C.orange}`, paddingLeft: 10 }}>
                    {sel.evaluation.reasoning_summary}
                  </div>
                )}
                {sel.evaluation.value_angle && (
                  <div style={{ fontSize: 10, color: C.blue, background: C.blueBg,
                    borderRadius: 4, padding: '6px 10px' }}>
                    💡 {sel.evaluation.value_angle}
                  </div>
                )}
              </div>
            )}

            {/* Reply variants */}
            {sel.replies?.length > 0 && (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '14px 20px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, color: C.muted, fontFamily: "'Lexend Zetta',sans-serif",
                    letterSpacing: .5 }}>CLAUDE'S REPLY DRAFTS</div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    {sel.replies.map(r => (
                      <button key={r.id} onClick={() => setVariant(r.variant)}
                        style={{ background: variant === r.variant ? C.orange : C.bg,
                          color: variant === r.variant ? '#fff' : C.mid,
                          border: `1px solid ${variant === r.variant ? C.orange : C.border}`,
                          borderRadius: 4, padding: '4px 10px', fontSize: 9,
                          fontFamily: "'Lexend Zetta',sans-serif", cursor: 'pointer' }}>
                        {r.variant === 1 ? 'Stronger' : 'Safer'}
                      </button>
                    ))}
                  </div>
                </div>

                {selReply && (
                  <>
                    {/* Reply approved / posted info */}
                    {selReply.approvedAt && (
                      <div style={{ fontSize: 10, color: C.green, background: C.greenBg,
                        borderRadius: 4, padding: '5px 9px', marginBottom: 8 }}>
                        ✓ Approved{selReply.approvedBy ? ` by ${selReply.approvedBy}` : ''}
                        {selReply.postedAt ? ' · Posted to Reddit' : ''}
                      </div>
                    )}

                    <div style={{ background: C.bg, borderRadius: 6, padding: '12px 14px',
                      fontSize: 12, color: C.dark, lineHeight: 1.7, whiteSpace: 'pre-wrap',
                      marginBottom: 12, minHeight: 80 }}>
                      {selReply.content}
                    </div>

                    {actErr && (
                      <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>{actErr}</div>
                    )}

                    {/* Copy-paste workflow */}
                    {!['POSTED', 'REJECTED', 'SKIPPED'].includes(sel.status) && (
                      <>
                        <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
                          Copy the reply below, then open the thread and paste it as a comment.
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button onClick={() => {
                            navigator.clipboard?.writeText(selReply.content).catch(() => {})
                            window.open(sel.url, '_blank', 'noopener,noreferrer')
                          }} style={{ background: C.orange, color: '#fff', border: 'none', borderRadius: 5,
                            padding: '9px 18px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                            fontFamily: "'Lexend Zetta',sans-serif" }}>
                            ⎘ Copy &amp; Open Thread
                          </button>
                          <CopyBtn text={selReply.content} label="⎘ Copy Reply" />
                          <button onClick={() => window.open(sel.url, '_blank', 'noopener,noreferrer')}
                            style={{ background: C.surface, color: C.mid, border: `1px solid ${C.border}`,
                              borderRadius: 5, padding: '9px 14px', fontSize: 10, cursor: 'pointer',
                              fontFamily: "'Lexend Zetta',sans-serif" }}>
                            ↗ Open Thread
                          </button>
                          <div style={{ flex: 1 }} />
                          <button onClick={() => markDone(sel.id)} disabled={marking === sel.id}
                            title="Mark as replied — removes from queue"
                            style={{ background: C.greenBg, color: C.green, border: `1px solid ${C.green}40`,
                              borderRadius: 5, padding: '9px 14px', fontSize: 10, cursor: marking === sel.id ? 'not-allowed' : 'pointer',
                              fontFamily: "'Lexend Zetta',sans-serif" }}>
                            {marking === sel.id ? '…' : '✓ Replied'}
                          </button>
                          <button onClick={() => skip(sel.id)} disabled={marking === sel.id}
                            style={{ background: C.surface, color: C.muted, border: `1px solid ${C.border}`,
                              borderRadius: 5, padding: '9px 14px', fontSize: 10, cursor: marking === sel.id ? 'not-allowed' : 'pointer',
                              fontFamily: "'Lexend Zetta',sans-serif" }}>
                            ✕ Skip
                          </button>
                        </div>
                      </>
                    )}

                    {sel.status === 'POSTED' && (
                      <div style={{ fontSize: 11, color: C.green }}>✓ Marked as replied</div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Evaluated but no replies yet */}
            {sel.evaluation?.decision === 'REPLY' && !sel.replies?.length && (
              <div style={{ background: '#fffbeb', border: `1px solid #fde68a`, borderRadius: 8,
                padding: '14px 20px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#92400e' }}>
                  ⏳ Claude thinks this is worth replying to (score: {sel.evaluation.fit_score}/10),
                  but reply drafts haven't been generated yet.
                  Click "Scan Now" to generate them.
                </div>
              </div>
            )}

            {/* SKIP/MONITOR evaluation */}
            {sel.evaluation?.decision && sel.evaluation.decision !== 'REPLY' && !sel.replies?.length && (
              <div style={{ background: '#f3f4f6', border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '14px 20px' }}>
                <div style={{ fontSize: 12, color: C.muted }}>
                  Claude decided to <strong>{sel.evaluation.decision}</strong> this thread.
                  {sel.evaluation.do_not_reply_reason && ` Reason: ${sel.evaluation.do_not_reply_reason}`}
                </div>
              </div>
            )}

            {/* No evaluation yet */}
            {!sel.evaluation && (
              <div style={{ background: '#fffbeb', border: `1px solid #fde68a`, borderRadius: 8,
                padding: '14px 20px' }}>
                <div style={{ fontSize: 12, color: '#92400e' }}>
                  ⏳ This thread is pending evaluation. Click "Scan Now" to have Claude score it.
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
