import React, { useState, useEffect, useCallback } from 'react'

const C = {
  bg: '#F2F2F0', surface: '#FFFFFF', border: '#E5E5E3',
  orange: '#F37321', dark: '#1A1A1A', mid: '#555', muted: '#888',
  green: '#16a34a', red: '#dc2626', yellow: '#d97706', blue: '#1A5FA8',
  redBg: '#fef2f2', greenBg: '#f0fdf4', orangeBg: '#FEF3EC', blueBg: '#E8F0FA',
  reddit: '#FF4500',
}

const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 22px', marginBottom: 14 }

const STATUS_COLOR = { PENDING: C.yellow, EVALUATED: C.blue, APPROVED: C.green, REJECTED: C.muted, POSTED: C.green, SKIPPED: C.muted }
const STATUS_BG    = { PENDING: '#fef9ec', EVALUATED: C.blueBg, APPROVED: C.greenBg, REJECTED: '#f9f9f9', POSTED: C.greenBg, SKIPPED: '#f9f9f9' }

function Pill({ label, color, bg }) {
  return (
    <span style={{ background: bg || `${color}18`, color, border: `1px solid ${color}30`, borderRadius: 99, padding: '2px 10px', fontSize: 10, fontWeight: 700, fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .3 }}>
      {label}
    </span>
  )
}

function Btn({ children, onClick, disabled, color = C.orange, outline }) {
  const bg = disabled ? '#e5e5e3' : outline ? C.surface : color
  const fc = disabled ? C.muted : outline ? color : '#fff'
  const bc = disabled ? '#e5e5e3' : color
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background: bg, color: fc, border: `1px solid ${bc}`, borderRadius: 6, padding: '7px 16px', fontSize: 11, fontWeight: 700, fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .4, cursor: disabled ? 'default' : 'pointer', flexShrink: 0 }}>
      {children}
    </button>
  )
}

async function api(action, body = {}) {
  const r = await fetch('/api/reddit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) })
  return r.json()
}

export default function Reddit() {
  const [status,   setStatus]   = useState(null)   // {flags, env}
  const [threads,  setThreads]  = useState([])
  const [tab,      setTab]      = useState('PENDING')
  const [scanning, setScanning] = useState(false)
  const [scanInfo, setScanInfo] = useState(null)   // {ingested, skipped}
  const [error,    setError]    = useState(null)
  const [working,  setWorking]  = useState({})     // threadId → action string
  const [replyMap, setReplyMap] = useState({})     // threadId → {variants, selected, editing}
  const [lastScan, setLastScan] = useState(null)

  const loadThreads = useCallback(async () => {
    const d = await api('threads', { limit: 100 })
    if (d.threads) setThreads(d.threads)
  }, [])

  const loadStatus = useCallback(async () => {
    const d = await api('status')
    if (d.flags !== undefined) setStatus(d)
  }, [])

  useEffect(() => {
    loadStatus()
    loadThreads()
  }, [])

  const scan = async () => {
    setScanning(true); setError(null); setScanInfo(null)
    try {
      const d = await api('ingest')
      if (d.error) { setError(d.error); }
      else { setScanInfo({ ingested: d.ingested ?? 0, skipped: d.skipped ?? 0 }); setLastScan(new Date()); }
      await loadThreads()
    } catch (e) { setError('Scan failed: ' + e.message) }
    setScanning(false)
  }

  const evaluate = async (t) => {
    setWorking(w => ({ ...w, [t.id]: 'Evaluating…' }))
    try {
      const d = await api('evaluate', { threadId: t.id })
      if (d.error) { setError(d.error); }
      else { await loadThreads(); setTab('EVALUATED') }
    } catch (e) { setError(e.message) }
    setWorking(w => { const n = { ...w }; delete n[t.id]; return n })
  }

  const generate = async (t) => {
    setWorking(w => ({ ...w, [t.id]: 'Writing reply…' }))
    try {
      const d = await api('generate', { threadId: t.id })
      if (d.error) { setError(d.error); }
      else if (d.skip) { setError('AI skipped this thread — no credible value-add'); await loadThreads(); }
      else if (d.replySet?.variants) {
        setReplyMap(m => ({ ...m, [t.id]: { variants: d.replySet.variants, selected: 0, text: d.replySet.variants[0]?.body || '' } }))
        await loadThreads()
      }
    } catch (e) { setError(e.message) }
    setWorking(w => { const n = { ...w }; delete n[t.id]; return n })
  }

  const approve = async (t, replyId) => {
    setWorking(w => ({ ...w, [t.id]: 'Approving…' }))
    try {
      const d = await api('approve', { threadId: t.id, replyId, decidedBy: 'Matt Stone' })
      if (d.error) setError(d.error)
      else { await loadThreads(); setTab('APPROVED') }
    } catch (e) { setError(e.message) }
    setWorking(w => { const n = { ...w }; delete n[t.id]; return n })
  }

  const reject = async (t) => {
    if (!window.confirm('Skip this thread?')) return
    setWorking(w => ({ ...w, [t.id]: 'Skipping…' }))
    try {
      await api('reject', { threadId: t.id, decidedBy: 'Matt Stone', reason: 'Not relevant' })
      await loadThreads()
    } catch (e) { setError(e.message) }
    setWorking(w => { const n = { ...w }; delete n[t.id]; return n })
  }

  const post = async (t) => {
    const rm = replyMap[t.id]
    const approvedReply = (t.replies || []).find(r => r.approvedAt && !r.rejectedAt)
    const replyId = approvedReply?.id
    if (!replyId) { setError('No approved reply found — approve a variant first'); return }
    if (!window.confirm('Post this reply to Reddit now?')) return
    setWorking(w => ({ ...w, [t.id]: 'Posting…' }))
    try {
      const d = await api('post', { replyId, decidedBy: 'Matt Stone' })
      if (d.error) setError(d.error)
      else { await loadThreads(); setTab('POSTED') }
    } catch (e) { setError(e.message) }
    setWorking(w => { const n = { ...w }; delete n[t.id]; return n })
  }

  const isConnected  = status?.env?.hasClientId && status?.env?.hasClientSecret
  const canPost      = status?.flags?.postingEnabled
  const tabCounts    = { PENDING: 0, EVALUATED: 0, APPROVED: 0, POSTED: 0 }
  threads.forEach(t => { if (tabCounts[t.status] !== undefined) tabCounts[t.status]++ })
  const visible = threads.filter(t => t.status === tab)

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '28px 32px', fontFamily: "'Lexend', sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, background: C.reddit, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 18, flexShrink: 0 }}>r/</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.dark }}>Reddit Engagement</h1>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Auto-monitor subreddits · AI-drafted replies · One-click post</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastScan && <span style={{ fontSize: 11, color: C.muted }}>Last scan: {lastScan.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          <Btn onClick={scan} disabled={scanning || !isConnected} color={C.reddit}>
            {scanning ? '⟳ SCANNING…' : '⟳ SCAN REDDIT'}
          </Btn>
        </div>
      </div>

      {/* Connection status */}
      {status && (
        <div style={{ ...card, padding: '12px 18px', marginBottom: 16, borderLeft: `3px solid ${isConnected ? C.green : C.red}` }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: isConnected ? C.green : C.red, fontWeight: 600 }}>
              {isConnected ? '● Connected' : '○ Not connected'}
            </span>
            {isConnected && (
              <>
                <span style={{ fontSize: 11, color: C.muted }}>
                  {status.env.hasRefreshToken ? '✓ OAuth token present' : '⚠ Using client credentials only (read-only)'}
                </span>
                {status.env.targetSubreddits?.length > 0 && (
                  <span style={{ fontSize: 11, color: C.mid }}>
                    Watching: {status.env.targetSubreddits.map(s => `r/${s}`).join(', ')}
                  </span>
                )}
                {status.env.brandKeywords?.length > 0 && (
                  <span style={{ fontSize: 11, color: C.mid }}>
                    Keywords: {status.env.brandKeywords.join(', ')}
                  </span>
                )}
              </>
            )}
            {!isConnected && (
              <span style={{ fontSize: 11, color: C.muted }}>Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN in Vercel env vars</span>
            )}
            {isConnected && !status.flags.enabled && (
              <span style={{ fontSize: 11, color: C.yellow }}>⚠ Set REDDIT_AUTOMATION_ENABLED=true to enable scanning</span>
            )}
            {isConnected && !canPost && (
              <span style={{ fontSize: 11, color: C.yellow }}>⚠ Set REDDIT_POSTING_ENABLED=true to allow posting</span>
            )}
          </div>
        </div>
      )}

      {/* Scan result */}
      {scanInfo && (
        <div style={{ ...card, padding: '10px 18px', marginBottom: 14, background: C.greenBg, borderColor: C.green }}>
          <span style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>
            ✓ Scan complete — {scanInfo.ingested} new threads ingested, {scanInfo.skipped} skipped
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ ...card, background: C.redBg, borderColor: C.red, marginBottom: 14, padding: '10px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: C.red, fontSize: 13 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
        </div>
      )}

      {/* Summary bar */}
      {threads.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          {[['PENDING', 'Pending Review'], ['EVALUATED', 'Evaluated'], ['APPROVED', 'Approved'], ['POSTED', 'Posted']].map(([s, l]) => (
            <button key={s} onClick={() => setTab(s)}
              style={{ background: tab === s ? STATUS_COLOR[s] : C.surface, color: tab === s ? '#fff' : STATUS_COLOR[s], border: `1px solid ${tab === s ? STATUS_COLOR[s] : C.border}`, borderRadius: 6, padding: '7px 16px', fontSize: 10, fontWeight: 700, fontFamily: "'Lexend Zetta', sans-serif", cursor: 'pointer', letterSpacing: .3 }}>
              {l} {tabCounts[s] > 0 ? `(${tabCounts[s]})` : ''}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {threads.length === 0 && !scanning && (
        <div style={{ ...card, textAlign: 'center', padding: '48px 32px' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.dark, marginBottom: 8 }}>No threads yet</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>
            {isConnected
              ? 'Click "Scan Reddit" to pull the latest posts from your target subreddits.'
              : 'Connect your Reddit account first — add REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_REFRESH_TOKEN to your Vercel environment variables, then set REDDIT_TARGET_SUBREDDITS and REDDIT_BRAND_KEYWORDS.'}
          </div>
          {isConnected && <Btn onClick={scan} disabled={scanning} color={C.reddit}>⟳ SCAN REDDIT NOW</Btn>}
        </div>
      )}

      {/* Thread list */}
      {visible.length === 0 && threads.length > 0 && (
        <div style={{ ...card, textAlign: 'center', padding: '32px', color: C.muted, fontSize: 13 }}>
          No {tab.toLowerCase()} threads. {tab === 'PENDING' ? 'Run a scan to pull new threads.' : 'Check other tabs.'}
        </div>
      )}

      {visible.map(t => {
        const rm = replyMap[t.id]
        const approvedReply = (t.replies || []).find(r => r.approvedAt && !r.rejectedAt)
        const w = working[t.id]
        const sc = STATUS_COLOR[t.status] || C.muted

        return (
          <div key={t.id} style={card}>
            {/* Thread header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 7, flexWrap: 'wrap' }}>
                  <Pill label={t.status} color={sc} bg={STATUS_BG[t.status]} />
                  <span style={{ fontSize: 12, color: C.muted }}>r/{t.subreddit}</span>
                  {t.score > 0 && <span style={{ fontSize: 12, color: C.muted }}>↑ {t.score}</span>}
                  {t.commentCount > 0 && <span style={{ fontSize: 12, color: C.muted }}>💬 {t.commentCount}</span>}
                  <span style={{ fontSize: 11, color: C.muted }}>by u/{t.author}</span>
                </div>
                <a href={t.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 14, fontWeight: 600, color: C.dark, textDecoration: 'none', lineHeight: 1.4, display: 'block', marginBottom: 6 }}>
                  {t.title}
                </a>
                {t.body && <div style={{ fontSize: 13, color: C.mid, lineHeight: 1.55, marginBottom: 6, maxHeight: 80, overflow: 'hidden' }}>{t.body.slice(0, 280)}{t.body.length > 280 ? '…' : ''}</div>}
              </div>
              <a href={t.url} target="_blank" rel="noopener noreferrer"
                style={{ background: C.reddit, color: '#fff', borderRadius: 6, padding: '7px 14px', fontSize: 11, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: "'Lexend Zetta', sans-serif" }}>
                OPEN ↗
              </a>
            </div>

            {/* Evaluation result */}
            {t.replies?.length > 0 && t.replies[0]?.body && (
              <div style={{ background: '#f8f8f6', border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: .5, marginBottom: 6 }}>
                  {t.replies.length} REPLY VARIANT{t.replies.length > 1 ? 'S' : ''} GENERATED
                </div>
                {(t.replies || []).map((reply, ri) => (
                  <div key={reply.id} style={{ marginBottom: ri < t.replies.length - 1 ? 10 : 0, padding: '8px 10px', background: reply.approvedAt ? C.greenBg : C.surface, border: `1px solid ${reply.approvedAt ? C.green : C.border}`, borderRadius: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ fontSize: 12, color: C.dark, lineHeight: 1.5, flex: 1 }}>{reply.body}</div>
                      {!reply.approvedAt && !reply.rejectedAt && t.status === 'EVALUATED' && (
                        <Btn onClick={() => approve(t, reply.id)} disabled={!!w} color={C.green} outline>✓ Approve</Btn>
                      )}
                      {reply.approvedAt && <Pill label="Approved" color={C.green} />}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Live reply editor (from in-session generate) */}
            {rm && !t.replies?.length && (
              <div style={{ marginBottom: 10 }}>
                {rm.variants?.length > 1 && (
                  <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                    {rm.variants.map((v, i) => (
                      <button key={i} onClick={() => setReplyMap(m => ({ ...m, [t.id]: { ...m[t.id], selected: i, text: v.body } }))}
                        style={{ background: rm.selected === i ? C.orange : C.surface, color: rm.selected === i ? '#fff' : C.muted, border: `1px solid ${rm.selected === i ? C.orange : C.border}`, borderRadius: 4, padding: '4px 10px', fontSize: 10, cursor: 'pointer' }}>
                        Variant {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                <textarea value={rm.text} onChange={e => setReplyMap(m => ({ ...m, [t.id]: { ...m[t.id], text: e.target.value } }))}
                  rows={4} style={{ width: '100%', background: '#f8f8f6', border: `1px solid ${C.border}`, borderRadius: 6, padding: '9px 12px', fontSize: 13, fontFamily: "'Lexend', sans-serif", color: C.dark, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
              {w && <span style={{ fontSize: 12, color: C.muted, alignSelf: 'center', fontStyle: 'italic' }}>{w}</span>}
              {!w && t.status === 'PENDING' && (
                <>
                  <Btn onClick={() => evaluate(t)} color={C.blue}>✦ EVALUATE</Btn>
                  <Btn onClick={() => reject(t)} outline color={C.muted}>Skip</Btn>
                </>
              )}
              {!w && t.status === 'EVALUATED' && !t.replies?.length && (
                <>
                  <Btn onClick={() => generate(t)} color={C.orange}>✦ GENERATE REPLY</Btn>
                  <Btn onClick={() => reject(t)} outline color={C.muted}>Skip</Btn>
                </>
              )}
              {!w && t.status === 'EVALUATED' && t.replies?.length > 0 && !approvedReply && (
                <span style={{ fontSize: 12, color: C.muted, alignSelf: 'center' }}>Approve a variant above to proceed</span>
              )}
              {!w && t.status === 'APPROVED' && approvedReply && (
                <>
                  {canPost
                    ? <Btn onClick={() => post(t)} color={C.reddit}>⬆ POST TO REDDIT</Btn>
                    : <span style={{ fontSize: 11, color: C.muted, alignSelf: 'center' }}>Set REDDIT_POSTING_ENABLED=true to post</span>}
                  <a href={t.url} target="_blank" rel="noopener noreferrer"
                    style={{ background: C.surface, color: C.mid, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 16px', fontSize: 11, fontWeight: 700, textDecoration: 'none', fontFamily: "'Lexend Zetta', sans-serif" }}>
                    POST MANUALLY ↗
                  </a>
                </>
              )}
              {!w && t.status === 'POSTED' && (
                <span style={{ fontSize: 12, color: C.green, fontWeight: 600, alignSelf: 'center' }}>✓ Posted to Reddit</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
