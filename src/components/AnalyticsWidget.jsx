import React, { useState, useEffect, useCallback } from 'react'

const B = {
  white:    '#FFFFFF',
  surface:  '#F8F7F5',
  orange:   '#F37321',
  orangeBg: '#FEF3EC',
  black:    '#000000',
  gray2:    '#B2B9C1',
  border:   '#E2E0DB',
  text:     '#1A1A18',
  muted:    '#7A7872',
  green:    '#1E8F4E',
  greenBg:  '#EAF7EE',
  red:      '#C0392B',
  pageBg:   '#F2F2F0',
}

function Card({ children, style }) {
  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,.05)', ...style }}>
      {children}
    </div>
  )
}

function KpiCard({ label, value, sub, highlight }) {
  return (
    <div style={{ background: highlight ? B.orangeBg : B.surface, borderRadius: 8, padding: '12px 10px', border: `1px solid ${highlight ? B.orange + '40' : B.border}` }}>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: highlight ? B.orange : B.muted, letterSpacing: 1.5, marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 20, color: highlight ? B.orange : B.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function BarRow({ label, value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{label}</span>
        <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: color || B.muted, flexShrink: 0 }}>{value}</span>
      </div>
      <div style={{ height: 4, background: B.surface, borderRadius: 2, border: `1px solid ${B.border}` }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color || B.orange, borderRadius: 2, transition: 'width .4s' }} />
      </div>
    </div>
  )
}

// ─── GA4 WIDGET ───────────────────────────────────────────────────────────────
export function GA4Widget({ autoRefreshSeconds = 60 }) {
  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [lastSync, setLastSync] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/analytics/ga4')
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setData(d)
      setLastSync(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, autoRefreshSeconds * 1000)
    return () => clearInterval(id)
  }, [load, autoRefreshSeconds])

  const topPageMax   = data?.topPages?.[0]?.activeUsers  || 1
  const topSrcMax    = data?.bySources?.[0]?.activeUsers || 1
  const topCountMax  = data?.byCountry?.[0]?.activeUsers || 1

  const deviceColors = { desktop: '#4285F4', mobile: '#34A853', tablet: '#FBBC05' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 17, color: B.black, letterSpacing: .3 }}>Live Traffic</div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted, marginTop: 1 }}>GA4 Realtime · auto-refreshes every {autoRefreshSeconds}s</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastSync && <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted }}>Updated {lastSync.toLocaleTimeString()}</span>}
          <button
            onClick={load}
            style={{ background: B.surface, color: B.muted, border: `1px solid ${B.border}`, borderRadius: 5, padding: '3px 10px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'pointer' }}
          >
            ↻
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: '9px 14px', background: '#FFF8E6', border: '1px solid #C7780030', borderRadius: 6, fontFamily: "'Lexend',sans-serif", fontSize: 11, color: '#C77800' }}>
          {error.includes('not configured') ? 'GA4 not connected — add GA4_PROPERTY_ID + credentials to enable real-time traffic.' : error}
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        <KpiCard label="ACTIVE USERS"  value={loading ? '…' : String(data?.activeUsers  || 0)} highlight={!!(data?.activeUsers)} />
        <KpiCard label="PAGE VIEWS"    value={loading ? '…' : String(data?.pageViews    || 0)} />
        <KpiCard label="EVENTS"        value={loading ? '…' : String(data?.eventCount   || 0)} />
      </div>

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          {/* Top pages */}
          <Card style={{ padding: '14px 16px' }}>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>TOP PAGES</div>
            {data.topPages?.length
              ? data.topPages.slice(0, 6).map((p, i) => (
                  <BarRow key={i} label={p.unifiedScreenName || p.pagePath || '/'} value={p.activeUsers} max={topPageMax} color={B.orange} />
                ))
              : <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.gray2 }}>No data</div>
            }
          </Card>

          {/* Traffic sources */}
          <Card style={{ padding: '14px 16px' }}>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>TRAFFIC SOURCES</div>
            {data.bySources?.length
              ? data.bySources.slice(0, 6).map((s, i) => (
                  <BarRow key={i} label={s.firstUserMedium || '(direct)'} value={s.activeUsers} max={topSrcMax} color="#4285F4" />
                ))
              : <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.gray2 }}>No data</div>
            }
          </Card>
        </div>
      )}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Device breakdown */}
          <Card style={{ padding: '14px 16px' }}>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>DEVICE BREAKDOWN</div>
            {data.byDevice?.length
              ? (() => {
                  const total = data.byDevice.reduce((s, d) => s + (d.activeUsers || 0), 0)
                  return data.byDevice.map((d, i) => {
                    const pct = total > 0 ? ((d.activeUsers / total) * 100).toFixed(0) : 0
                    const cat = (d.deviceCategory || '').toLowerCase()
                    const col = deviceColors[cat] || B.gray2
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: col, flexShrink: 0 }} />
                        <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.text, textTransform: 'capitalize', flex: 1 }}>{d.deviceCategory}</span>
                        <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: col }}>{d.activeUsers} <span style={{ color: B.muted }}>({pct}%)</span></span>
                      </div>
                    )
                  })
                })()
              : <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.gray2 }}>No data</div>
            }
          </Card>

          {/* Top countries */}
          <Card style={{ padding: '14px 16px' }}>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>TOP COUNTRIES</div>
            {data.byCountry?.length
              ? data.byCountry.slice(0, 5).map((c, i) => (
                  <BarRow key={i} label={c.country || '(unknown)'} value={c.activeUsers} max={topCountMax} color={B.green} />
                ))
              : <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.gray2 }}>No data</div>
            }
          </Card>
        </div>
      )}
    </div>
  )
}

// ─── GTM WIDGET ───────────────────────────────────────────────────────────────
export function GTMWidget() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch('/api/analytics/gtm')
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 17, color: B.black, marginBottom: 14 }}>Tag Manager</div>

      {error && (
        <div style={{ padding: '9px 14px', background: '#FFF8E6', border: '1px solid #C7780030', borderRadius: 6, fontFamily: "'Lexend',sans-serif", fontSize: 11, color: '#C77800', marginBottom: 12 }}>
          {error.includes('not configured') ? 'GTM not connected — add GTM_ACCOUNT_ID to enable tag management.' : error}
        </div>
      )}

      {loading && <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted }}>Loading GTM status…</div>}

      {data && (
        <>
          {/* Summary row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            <KpiCard label="TAGS"         value={String(data.tagCount     || 0)} />
            <KpiCard label="TRIGGERS"     value={String(data.triggerCount || 0)} />
            <KpiCard label="PAUSED TAGS"  value={String(data.pausedTags   || 0)} highlight={data.pausedTags > 0} />
          </div>

          {data.workspace && (
            <div style={{ marginBottom: 14, padding: '9px 12px', background: B.surface, border: `1px solid ${B.border}`, borderRadius: 7, fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.text }}>
              <span style={{ color: B.muted }}>Workspace: </span><strong>{data.workspace.name}</strong>
              {data.workspace.description && <span style={{ color: B.muted }}> — {data.workspace.description}</span>}
            </div>
          )}

          {data.tags?.length > 0 && (
            <Card style={{ padding: '12px 14px', marginBottom: 10 }}>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 10 }}>TAGS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {data.tags.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', background: t.paused ? '#FFF8E6' : B.surface, borderRadius: 5, border: `1px solid ${t.paused ? '#C7780030' : B.border}` }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.paused ? '#C77800' : B.green, flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted, letterSpacing: 0.3 }}>{t.type}</span>
                    {t.paused && <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: '#C77800', letterSpacing: 0.5 }}>PAUSED</span>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

// ─── COMBINED ANALYTICS MODULE ────────────────────────────────────────────────
const ATABS = [
  { id: 'realtime', label: 'Realtime Traffic' },
  { id: 'gtm',      label: 'Tag Manager'       },
]

export default function AnalyticsWidget() {
  const [tab, setTab] = useState('realtime')

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <div style={{ width: 40, height: 40, background: B.orange, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>📈</div>
        <div>
          <h1 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 20, color: B.black, letterSpacing: .3, margin: 0 }}>Analytics</h1>
          <p style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted, margin: '3px 0 0', lineHeight: 1.5 }}>
            Google Analytics 4 real-time traffic and Google Tag Manager container status.
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, background: B.surface, borderRadius: 8, padding: 3, border: `1px solid ${B.border}`, marginBottom: 20, alignSelf: 'flex-start', width: 'fit-content' }}>
        {ATABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background:  tab === t.id ? B.white  : 'transparent',
              color:       tab === t.id ? B.orange : B.muted,
              border:      tab === t.id ? `1px solid ${B.border}` : '1px solid transparent',
              borderRadius: 6, padding: '7px 18px', fontSize: 10,
              fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5,
              cursor: 'pointer',
              boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
              transition: 'all .12s',
            }}
          >
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'realtime' && <GA4Widget />}
      {tab === 'gtm'      && <GTMWidget />}
    </div>
  )
}
