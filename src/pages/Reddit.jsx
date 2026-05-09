import React, { useState } from 'react'

const C = {
  bg: '#F2F2F0', surface: '#FFFFFF', border: '#E5E5E3',
  orange: '#F37321', dark: '#1A1A1A', mid: '#555', muted: '#888',
  green: '#16a34a', red: '#dc2626', yellow: '#d97706',
  redBg: '#fef2f2', greenBg: '#f0fdf4',
  reddit: '#FF4500',
}

const card = {
  background: C.surface, border: `1px solid ${C.border}`,
  borderRadius: 10, padding: '18px 22px', marginBottom: 14,
}

const IS = {
  width: '100%', background: C.bg, border: `1px solid ${C.border}`,
  borderRadius: 6, padding: '9px 12px', fontSize: 13,
  fontFamily: "'Lexend', sans-serif", color: C.dark, outline: 'none',
}

const ST1 = `ST1 Sports (st1sports.com) supplies athletic equipment to K-12 schools: track & field (Blazer, Gill Athletics), baseball (Diamond), balls/bats (Wilson, Molten, DeMarini, Louisville Slugger), timing systems (FinishLynx), protective gear (All-Star, EvoShield). Based in Iowa, serving Iowa/Colorado/Minnesota/North Dakota.`

const QUICK_SEARCHES = [
  'track hurdles equipment', 'baseball helmets school', 'athletic equipment budget',
  'volleyball school program', 'timing system track meet', 'equipment bid RFP',
]

export default function Reddit() {
  const [keywords,  setKeywords]  = useState('')
  const [searching, setSearching] = useState(false)
  const [threads,   setThreads]   = useState([])
  const [error,     setError]     = useState(null)
  const [replyMap,  setReplyMap]  = useState({})  // id → {loading, reply, editing}
  const [copied,    setCopied]    = useState(null)

  async function searchThreads() {
    const q = keywords.trim()
    if (!q) return
    setSearching(true); setError(null); setThreads([]); setReplyMap({})
    try {
      const r = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{
            role: 'user',
            content: `Search Reddit for recent posts about: "${q}" in subreddits relevant to school athletic programs, coaches, ADs, or sports equipment purchasing (e.g. r/trackandfield, r/baseball, r/Volleyball, r/HighSchoolSports, r/Coaches, r/athletictraining).

Find 5-8 active threads where an athletic equipment company could add genuine value.

Return ONLY a valid JSON array, no other text:
[{
  "id": "short unique id",
  "title": "thread title",
  "subreddit": "subreddit without r/",
  "url": "full reddit.com url",
  "upvotes": number or null,
  "commentCount": number or null,
  "body": "2-3 sentence summary of the post/question",
  "relevance": "one sentence: why an equipment supplier could help here",
  "score": relevance score 1-10
}]`,
          }],
        }),
      })
      const d = await r.json()
      const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
      const m = text.match(/\[[\s\S]*\]/)
      if (m) {
        const parsed = JSON.parse(m[0])
        setThreads(parsed.sort((a, b) => (b.score || 0) - (a.score || 0)))
      } else {
        setError('No threads found — try different keywords or be more specific')
      }
    } catch (e) {
      setError('Search failed: ' + e.message)
    } finally {
      setSearching(false)
    }
  }

  async function generateReply(thread) {
    setReplyMap(m => ({ ...m, [thread.id]: { loading: true } }))
    try {
      const r = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          system: `You are helping Matt Stone at ST1 Sports engage authentically on Reddit.
Rules: be genuinely helpful first — promotional only if naturally relevant. Match Reddit's casual, direct tone. Provide real expertise on athletic equipment, school programs, specifications. Only mention ST1 Sports if it fits naturally. Max 120 words. No emojis. No corporate language. Sound like a knowledgeable industry person, not marketing.`,
          messages: [{
            role: 'user',
            content: `Write a single helpful Reddit reply to this thread.

Thread title: "${thread.title}"
Subreddit: r/${thread.subreddit}
Context: ${thread.body}

Why ST1 can add value: ${thread.relevance}

ST1 context (use only if naturally relevant): ${ST1}

Write the reply directly — no preamble, just the reply text.`,
          }],
        }),
      })
      const d = await r.json()
      const reply = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim()
      setReplyMap(m => ({ ...m, [thread.id]: { loading: false, reply } }))
    } catch (e) {
      setReplyMap(m => ({ ...m, [thread.id]: { loading: false, error: e.message } }))
    }
  }

  function updateReply(id, text) {
    setReplyMap(m => ({ ...m, [id]: { ...m[id], reply: text } }))
  }

  function copy(text, id) {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const scoreColor = s => s >= 7 ? C.green : s >= 4 ? C.yellow : C.red

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '28px 32px', fontFamily: "'Lexend', sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div style={{ width: 40, height: 40, background: C.reddit, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 18 }}>r/</div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.dark }}>Reddit Engagement</h1>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Find relevant threads · Generate genuine replies · Build community presence</p>
        </div>
      </div>

      {/* Search box */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: .5, marginBottom: 8 }}>FIND THREADS</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...IS, flex: 1 }}
            value={keywords}
            onChange={e => setKeywords(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchThreads()}
            placeholder="e.g. track hurdles, baseball helmets, school athletic budget…"
          />
          <button
            onClick={searchThreads}
            disabled={searching || !keywords.trim()}
            style={{ background: (searching || !keywords.trim()) ? C.muted : C.orange, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 22px', fontSize: 11, fontWeight: 700, fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .5, cursor: (searching || !keywords.trim()) ? 'default' : 'pointer', flexShrink: 0 }}
          >
            {searching ? 'SEARCHING…' : 'SEARCH REDDIT →'}
          </button>
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {QUICK_SEARCHES.map(q => (
            <button key={q} onClick={() => setKeywords(q)}
              style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 99, padding: '3px 11px', fontSize: 11, color: C.muted, cursor: 'pointer', fontFamily: "'Lexend', sans-serif" }}>
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ ...card, background: C.redBg, borderColor: C.red, marginBottom: 16 }}>
          <span style={{ color: C.red, fontSize: 13 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Results */}
      {threads.map(t => {
        const rg = replyMap[t.id] || {}
        const sc = scoreColor(t.score)
        return (
          <div key={t.id} style={card}>
            {/* Thread header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                  <span style={{ background: `${sc}18`, color: sc, border: `1px solid ${sc}33`, borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 700, fontFamily: "'Lexend Zetta', sans-serif" }}>{t.score}/10</span>
                  <span style={{ fontSize: 12, color: C.muted }}>r/{t.subreddit}</span>
                  {t.upvotes != null && <span style={{ fontSize: 12, color: C.muted }}>↑ {t.upvotes}</span>}
                  {t.commentCount != null && <span style={{ fontSize: 12, color: C.muted }}>💬 {t.commentCount}</span>}
                </div>
                <a href={t.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 14, fontWeight: 600, color: C.dark, textDecoration: 'none', lineHeight: 1.4, display: 'block', marginBottom: 5 }}>
                  {t.title}
                </a>
                {t.body && <div style={{ fontSize: 13, color: C.mid, lineHeight: 1.55, marginBottom: 5 }}>{t.body}</div>}
                <div style={{ fontSize: 12, color: C.orange, fontStyle: 'italic' }}>{t.relevance}</div>
              </div>
              <a href={t.url} target="_blank" rel="noopener noreferrer"
                style={{ background: C.reddit, color: '#fff', borderRadius: 6, padding: '7px 14px', fontSize: 11, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: "'Lexend Zetta', sans-serif", letterSpacing: .3 }}>
                OPEN ↗
              </a>
            </div>

            {/* Reply section */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
              {!rg.reply && !rg.loading && (
                <button onClick={() => generateReply(t)}
                  style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 14px', fontSize: 12, color: C.mid, cursor: 'pointer', fontFamily: "'Lexend', sans-serif" }}>
                  ✦ Generate reply
                </button>
              )}
              {rg.loading && (
                <div style={{ fontSize: 13, color: C.muted, fontStyle: 'italic' }}>Drafting reply…</div>
              )}
              {rg.error && (
                <div style={{ fontSize: 12, color: C.red }}>{rg.error}</div>
              )}
              {rg.reply && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: .5 }}>SUGGESTED REPLY</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setReplyMap(m => ({ ...m, [t.id]: {} }))}
                        style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: C.muted }}>
                        ↺ Redo
                      </button>
                      <button onClick={() => copy(rg.reply, t.id)}
                        style={{ background: copied === t.id ? C.green : C.orange, color: '#fff', border: 'none', borderRadius: 4, padding: '3px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'Lexend Zetta', sans-serif" }}>
                        {copied === t.id ? '✓ COPIED' : 'COPY'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={rg.reply}
                    onChange={e => updateReply(t.id, e.target.value)}
                    rows={5}
                    style={{ ...IS, resize: 'vertical', lineHeight: 1.6 }}
                  />
                  <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                    <a href={t.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: C.reddit, textDecoration: 'none', fontWeight: 600 }}>
                      Post on Reddit ↗
                    </a>
                    <span style={{ fontSize: 12, color: C.muted }}>· Copy reply first, then open thread to paste</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Empty state */}
      {threads.length === 0 && !searching && !error && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 14, marginBottom: 6 }}>Search for a topic to find relevant threads</div>
          <div style={{ fontSize: 12 }}>Focus on questions your customers actually ask about equipment, buying, programs</div>
        </div>
      )}
    </div>
  )
}
