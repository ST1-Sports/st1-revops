import React, { useState, useEffect, useCallback } from 'react'

// ─── palette + base styles (matches RevOps.jsx conventions) ──────────────────
const C = {
  bg:      '#F2F2F0',
  surface: '#FFFFFF',
  border:  '#E5E5E3',
  orange:  '#F37321',
  dark:    '#1A1A1A',
  mid:     '#555',
  muted:   '#888',
  green:   '#16a34a',
  red:     '#dc2626',
  yellow:  '#d97706',
}

const card = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: '20px 24px',
  marginBottom: 16,
}

const pill = (color) => ({
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: 99,
  fontSize: 11,
  fontWeight: 700,
  fontFamily: "'Lexend Zetta', sans-serif",
  letterSpacing: .5,
  background: color + '18',
  color,
  border: `1px solid ${color}33`,
})

const btn = (primary) => ({
  padding: '8px 18px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: "'Lexend', sans-serif",
  fontWeight: 600,
  background: primary ? C.orange : C.surface,
  color:      primary ? '#fff'   : C.dark,
  border:     primary ? 'none'   : `1px solid ${C.border}`,
})

// ─── status helpers ──────────────────────────────────────────────────────────

const STATUS_COLOR = {
  PENDING:   C.muted,
  EVALUATED: C.yellow,
  NOTIFIED:  '#7c3aed',
  APPROVED:  C.green,
  REJECTED:  C.red,
  POSTED:    C.green,
  SKIPPED:   C.muted,
}

function StatusPill({ status }) {
  return <span style={pill(STATUS_COLOR[status] || C.muted)}>{status}</span>
}

function FitScore({ score }) {
  const color = score >= 7 ? C.green : score >= 4 ? C.yellow : C.red
  return (
    <span style={{ ...pill(color), minWidth: 32, textAlign: 'center' }}>
      {score}/10
    </span>
  )
}

// ─── main component ──────────────────────────────────────────────────────────

export default function Reddit() {
  const [flags,     setFlags]    = useState(null)
  const [threads,   setThreads]  = useState([])
  const [loading,   setLoading]  = useState(false)
  const [error,     setError]    = useState(null)
  const [filter,    setFilter]   = useState('all')
  const [action,    setAction]   = useState(null)  // { type, threadId, replyId }

  // Load status + flags on mount
  useEffect(() => {
    fetch('/api/reddit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) setFlags(d.flags) })
      .catch(() => setError('Could not reach /api/reddit'))
  }, [])

  const loadThreads = useCallback(async (statusFilter) => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/reddit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'threads',
          status: statusFilter === 'all' ? undefined : statusFilter,
          limit:  100,
        }),
      })
      const d = await r.json()
      if (d.ok) setThreads(d.threads || [])
      else setError(d.error)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (flags?.enabled) loadThreads(filter)
  }, [flags, filter, loadThreads])

  const handleApprove = async (threadId, replyId) => {
    setAction({ type: 'approving', threadId, replyId })
    const r = await fetch('/api/reddit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', threadId, replyId, decidedBy: 'reviewer' }),
    }).then(r => r.json())
    setAction(null)
    if (r.ok) loadThreads(filter)
    else setError(r.error)
  }

  const handleReject = async (threadId, reason) => {
    setAction({ type: 'rejecting', threadId })
    const r = await fetch('/api/reddit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', threadId, decidedBy: 'reviewer', reason }),
    }).then(r => r.json())
    setAction(null)
    if (r.ok) loadThreads(filter)
    else setError(r.error)
  }

  const handlePost = async (replyId) => {
    if (!flags?.postingEnabled) {
      setError('Posting is disabled (REDDIT_POSTING_ENABLED=false). Enable it in Vercel env vars to post.')
      return
    }
    if (!window.confirm('Post this reply to Reddit? This cannot be undone.')) return
    setAction({ type: 'posting', replyId })
    const r = await fetch('/api/reddit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'post', replyId }),
    }).then(r => r.json())
    setAction(null)
    if (r.ok) loadThreads(filter)
    else setError(r.error)
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '28px 32px', fontFamily: "'Lexend', sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
        <div style={{
          width: 40, height: 40, background: '#FF4500', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 900, fontSize: 18,
        }}>r/</div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.dark }}>Reddit Engagement</h1>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Approval-first workflow — no reply posts without human review</p>
        </div>
      </div>

      {/* Feature flag warning */}
      {flags && !flags.enabled && (
        <div style={{ ...card, background: '#fef3c7', borderColor: C.yellow, marginBottom: 24 }}>
          <strong style={{ color: C.yellow }}>Module disabled</strong>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: C.mid }}>
            Set <code>REDDIT_ENABLED=true</code> in your Vercel environment variables to activate ingestion and evaluation.
            Posting remains separately gated by <code>REDDIT_POSTING_ENABLED</code>.
          </p>
        </div>
      )}

      {/* Flags summary bar */}
      {flags && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <FlagChip label="Module" active={flags.enabled} />
          <FlagChip label="Posting" active={flags.postingEnabled} />
          <span style={{ fontSize: 12, color: C.muted, alignSelf: 'center' }}>
            Max {flags.maxPostsPerDay} posts/day · Min score {flags.minThreadScore}
          </span>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{ ...card, background: '#fef2f2', borderColor: C.red, marginBottom: 20 }}>
          <span style={{ color: C.red, fontSize: 13 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: C.muted }}>×</button>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {['all', 'PENDING', 'EVALUATED', 'NOTIFIED', 'APPROVED', 'POSTED', 'REJECTED', 'SKIPPED'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 14px', borderRadius: 6, border: `1px solid ${filter === f ? C.orange : C.border}`,
              background: filter === f ? C.orange : C.surface,
              color: filter === f ? '#fff' : C.mid,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: "'Lexend Zetta', sans-serif",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Thread list */}
      {!flags?.enabled ? (
        <EmptyState message="Enable the Reddit module to start ingesting threads." />
      ) : loading ? (
        <LoadingState />
      ) : threads.length === 0 ? (
        <EmptyState message={`No threads with status "${filter}". Run an ingestion to populate.`} />
      ) : (
        threads.map(thread => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            flags={flags}
            pendingAction={action}
            onApprove={handleApprove}
            onReject={handleReject}
            onPost={handlePost}
          />
        ))
      )}
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

function FlagChip({ label, active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 12px', borderRadius: 99,
      fontSize: 12, fontWeight: 600,
      background: active ? '#dcfce7' : '#f3f4f6',
      color: active ? C.green : C.muted,
      border: `1px solid ${active ? '#86efac' : C.border}`,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? C.green : C.muted, display: 'inline-block' }} />
      {label}: {active ? 'ON' : 'OFF'}
    </span>
  )
}

function ThreadCard({ thread, flags, pendingAction, onApprove, onReject, onPost }) {
  const [expanded, setExpanded] = useState(false)
  const evaluation = thread.evaluation || {}
  const isBusy = pendingAction?.threadId === thread.id || thread.replies?.some(r => pendingAction?.replyId === r.id)

  return (
    <div style={card}>
      {/* Thread header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <StatusPill status={thread.status} />
            {evaluation.fitScore != null && <FitScore score={evaluation.fitScore} />}
            <span style={{ fontSize: 12, color: C.muted }}>r/{thread.subreddit}</span>
            <span style={{ fontSize: 12, color: C.muted }}>↑{thread.score}</span>
          </div>
          <a
            href={thread.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 14, fontWeight: 600, color: C.dark, textDecoration: 'none' }}
          >
            {thread.title}
          </a>
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: C.mid }}
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 16 }}>
          {/* Thread body */}
          {thread.body && (
            <div style={{ fontSize: 13, color: C.mid, background: C.bg, borderRadius: 6, padding: '10px 14px', marginBottom: 14, maxHeight: 120, overflow: 'auto', lineHeight: 1.5 }}>
              {thread.body}
            </div>
          )}

          {/* Evaluation */}
          {evaluation.reasoning && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: .5, marginBottom: 4 }}>EVALUATION</div>
              <div style={{ fontSize: 13, color: C.mid }}>{evaluation.reasoning}</div>
              {evaluation.topics?.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {evaluation.topics.map(t => (
                    <span key={t} style={{ ...pill(C.muted), fontSize: 11 }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reply variants */}
          {thread.replies?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: .5, marginBottom: 8 }}>REPLY VARIANTS</div>
              {thread.replies.map(reply => (
                <ReplyCard
                  key={reply.id}
                  reply={reply}
                  thread={thread}
                  flags={flags}
                  isBusy={isBusy}
                  onApprove={onApprove}
                  onPost={onPost}
                />
              ))}
            </div>
          )}

          {/* Reject */}
          {['NOTIFIED', 'EVALUATED', 'APPROVED'].includes(thread.status) && (
            <button
              onClick={() => onReject(thread.id, 'Manually rejected via review UI')}
              disabled={isBusy}
              style={{ ...btn(false), color: C.red, borderColor: C.red + '44', fontSize: 12 }}
            >
              Reject all variants
            </button>
          )}

          {/* Posted metrics */}
          {thread.status === 'POSTED' && thread.replies?.some(r => r.postedAt) && (
            <PostedMetrics reply={thread.replies.find(r => r.postedAt)} />
          )}
        </div>
      )}
    </div>
  )
}

function ReplyCard({ reply, thread, flags, isBusy, onApprove, onPost }) {
  const isApproved = Boolean(reply.approvedAt)
  const isPosted   = Boolean(reply.postedAt)

  return (
    <div style={{
      border: `1px solid ${isApproved ? C.green + '55' : C.border}`,
      borderRadius: 8, padding: '12px 16px', marginBottom: 10,
      background: isApproved ? '#f0fdf4' : C.surface,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>VARIANT {reply.variant}</span>
        {isPosted && (
          <span style={pill(C.green)}>POSTED</span>
        )}
        {isApproved && !isPosted && (
          <span style={pill(C.green)}>APPROVED</span>
        )}
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 14, color: C.dark, lineHeight: 1.5 }}>
        {reply.content}
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        {!isApproved && !isPosted && thread.status !== 'REJECTED' && (
          <button
            onClick={() => onApprove(thread.id, reply.id)}
            disabled={isBusy}
            style={{ ...btn(true), fontSize: 12 }}
          >
            {isBusy ? 'Approving…' : 'Approve'}
          </button>
        )}
        {isApproved && !isPosted && (
          <button
            onClick={() => onPost(reply.id)}
            disabled={isBusy || !flags?.postingEnabled}
            title={!flags?.postingEnabled ? 'Posting disabled — set REDDIT_POSTING_ENABLED=true' : ''}
            style={{ ...btn(true), fontSize: 12, background: flags?.postingEnabled ? C.green : C.muted }}
          >
            {isBusy ? 'Posting…' : 'Post to Reddit'}
          </button>
        )}
        {isPosted && reply.redditCommentId && (
          <a
            href={`https://reddit.com/r/${thread.subreddit}/comments/${thread.redditId?.replace('t3_', '')}/_/${reply.redditCommentId?.replace('t1_', '')}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...btn(false), fontSize: 12, textDecoration: 'none', display: 'inline-block' }}
          >
            View on Reddit →
          </a>
        )}
      </div>
    </div>
  )
}

function PostedMetrics({ reply }) {
  if (!reply) return null
  return (
    <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
      Posted {reply.postedAt ? new Date(reply.postedAt).toLocaleDateString() : ''}
      {reply.upvotes != null && ` · ${reply.upvotes} upvotes`}
      {reply.redditCommentId && ` · ID: ${reply.redditCommentId}`}
    </div>
  )
}

function EmptyState({ message }) {
  return (
    <div style={{ ...card, textAlign: 'center', padding: '48px 24px', color: C.muted }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
      <div style={{ fontSize: 14 }}>{message}</div>
    </div>
  )
}

function LoadingState() {
  return (
    <div style={{ ...card, textAlign: 'center', padding: '48px 24px', color: C.muted }}>
      <div style={{ fontSize: 14 }}>Loading threads…</div>
    </div>
  )
}
