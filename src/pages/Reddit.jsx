import React, { useState, useEffect, useRef } from 'react'

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
}

// ─── tiny helpers ────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CopyBtn({ text, label = '⎘ COPY REPLY', successLabel = '✓ COPIED' }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }
  return (
    <button onClick={copy}
      style={{ background: copied ? C.green : C.orange, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .4, transition: 'background .2s' }}>
      {copied ? successLabel : label}
    </button>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

export default function Reddit() {
  const [feed,    setFeed]    = useState({ threads: [], lastRunDate: null, runDescription: '', loading: true, error: null })
  const [sel,     setSel]     = useState(null)    // selected thread from feed
  const [detail,  setDetail]  = useState(null)    // { body, topComments, loading, fetchError }
  const [reply,   setReply]   = useState('')      // editable reply text
  const replyRef              = useRef(null)

  // Load Slack feed on mount
  useEffect(() => {
    fetch('/api/reddit/slack-feed')
      .then(r => r.json())
      .then(d => setFeed({ ...d, loading: false, error: d.error || null }))
      .catch(e => setFeed(f => ({ ...f, loading: false, error: e.message })))
  }, [])

  // When thread changes, pre-fill reply and fetch Reddit thread detail
  useEffect(() => {
    if (!sel) return
    setReply(sel.suggestedReply)
    setDetail({ loading: true })
    fetch(`/api/reddit/thread-detail?url=${encodeURIComponent(sel.url)}`)
      .then(r => r.json())
      .then(d => setDetail({ ...d, loading: false }))
      .catch(e => setDetail({ loading: false, fetchError: e.message, body: '', topComments: [] }))
  }, [sel?.id])

  const openAndPaste = (url) => {
    // Copy reply first so user can immediately Ctrl+V in the Reddit comment box
    navigator.clipboard?.writeText(reply).catch(() => {})
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Lexend', sans-serif", background: C.bg }}>

      {/* ── Left sidebar: thread list ─────────────────────────────────────── */}
      <div style={{ width: 360, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.surface }}>

        {/* Sidebar header */}
        <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 34, height: 34, background: C.reddit, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 14, flexShrink: 0 }}>r/</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.dark }}>Reddit Engagement</div>
              <div style={{ fontSize: 10, color: C.muted }}>via Perplexity Monitor → Slack #reddit</div>
            </div>
          </div>

          {feed.lastRunDate && (
            <div style={{ fontSize: 11, color: C.muted, background: '#f5f5f4', borderRadius: 6, padding: '5px 10px', lineHeight: 1.5 }}>
              <strong style={{ color: C.mid }}>{fmtDate(feed.lastRunDate)}</strong>
              {' · '}
              <strong style={{ color: C.reddit }}>{feed.threads.length}</strong> threads
              {feed.runDescription && <span> · {feed.runDescription}</span>}
            </div>
          )}
        </div>

        {/* Thread list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
          {feed.loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted, fontSize: 13 }}>Loading…</div>
          )}
          {feed.error && !feed.loading && (
            <div style={{ padding: 16, color: C.red, fontSize: 12, lineHeight: 1.5 }}>
              <strong>Could not load feed</strong><br />{feed.error}<br />
              <span style={{ color: C.muted }}>Check SLACK_BOT_TOKEN env var.</span>
            </div>
          )}
          {!feed.loading && !feed.error && feed.threads.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
              No threads found in #reddit.<br />The Perplexity monitor posts each morning.
            </div>
          )}

          {feed.threads.map(t => {
            const active = sel?.id === t.id
            return (
              <button key={t.id} onClick={() => setSel(t)}
                style={{ width: '100%', textAlign: 'left', display: 'block', background: active ? C.orangeBg : 'transparent', border: `1px solid ${active ? C.orange : C.border}`, borderRadius: 8, padding: '11px 13px', marginBottom: 7, cursor: 'pointer', transition: 'border-color .15s, background .15s' }}>
                <div style={{ fontSize: 9, color: C.reddit, fontWeight: 700, fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .5, marginBottom: 4 }}>
                  {t.subreddit}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.dark, lineHeight: 1.35, marginBottom: 5 }}>
                  {t.title}
                </div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {t.suggestedReply.slice(0, 100)}…
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Right panel: thread detail + reply ───────────────────────────── */}
      {!sel ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: C.muted }}>
          <div style={{ fontSize: 36 }}>💬</div>
          <div style={{ fontSize: 14, color: C.mid }}>Select a thread to review and reply</div>
          <div style={{ fontSize: 12, color: C.muted }}>Your Perplexity-drafted reply will be pre-loaded and editable</div>
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
                <div style={{ fontSize: 17, fontWeight: 700, color: C.dark, lineHeight: 1.3 }}>
                  {sel.title}
                </div>
              </div>
              <button
                onClick={() => openAndPaste(sel.url)}
                style={{ background: C.reddit, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .4, whiteSpace: 'nowrap', flexShrink: 0 }}>
                OPEN & PASTE ↗
              </button>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: C.blue }}>
              <a href={sel.url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue, textDecoration: 'none' }}>
                {sel.url}
              </a>
            </div>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* ── Reddit thread content ── */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: .8, marginBottom: 10, fontFamily: "'Lexend Zetta', sans-serif" }}>
                THREAD CONTEXT
              </div>

              {detail?.loading && (
                <div style={{ fontSize: 13, color: C.muted, padding: '14px 0' }}>Loading thread…</div>
              )}

              {detail && !detail.loading && (
                <>
                  {/* OP body */}
                  {detail.body ? (
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', marginBottom: 12, borderLeft: `3px solid ${C.reddit}` }}>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .5, marginBottom: 8 }}>ORIGINAL POST</div>
                      <div style={{ fontSize: 13, color: C.dark, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{detail.body}</div>
                    </div>
                  ) : (
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px', marginBottom: 12, fontSize: 12, color: C.muted }}>
                      {detail.fetchError
                        ? `Could not load thread content — ${detail.fetchError}`
                        : 'No post body (link post or removed). Click "Open & Paste" to view on Reddit.'}
                    </div>
                  )}

                  {/* Top comments */}
                  {detail.topComments?.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: .5, marginBottom: 8, fontFamily: "'Lexend Zetta', sans-serif" }}>TOP COMMENTS</div>
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

            {/* ── Reply editor ── */}
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
                  rows={8}
                  style={{ width: '100%', background: '#f9f9f7', border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 13px', fontSize: 13, fontFamily: "'Lexend', sans-serif", color: C.dark, resize: 'vertical', lineHeight: 1.65, boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <CopyBtn text={reply} />
                  <button
                    onClick={() => openAndPaste(sel.url)}
                    style={{ background: C.reddit, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .4 }}>
                    OPEN & PASTE ↗
                  </button>
                  <span style={{ fontSize: 11, color: C.muted, flex: 1, minWidth: 200 }}>
                    "Open & Paste" copies your reply then opens Reddit — just Ctrl+V in the comment box.
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
