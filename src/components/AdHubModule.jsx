import React, { useState, useEffect, useCallback, useRef } from 'react'
import { routeTask } from '../lib/aiRouter.js'
import { readAppState, setAppStateField } from '../lib/appStateSync.js'

// ─── BRAND ────────────────────────────────────────────────────────────────────
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
  redBg:    '#FDECEA',
  pageBg:   '#F2F2F0',
  blue:     '#1A5FA8',
  blueBg:   '#E8F0FA',
  purple:   '#6B3FA0',
}

// ─── PLATFORM CONFIG ──────────────────────────────────────────────────────────
export const PLATFORMS = [
  { id: 'meta',      label: 'Meta',      color: '#1877F2', bg: '#E7F0FD', endpoint: '/api/ads/meta'      },
  { id: 'google',    label: 'Google',    color: '#34A853', bg: '#E6F4EA', endpoint: '/api/ads/google'    },
  { id: 'linkedin',  label: 'LinkedIn',  color: '#0A66C2', bg: '#E8F0FA', endpoint: '/api/ads/linkedin'  },
  { id: 'tiktok',    label: 'TikTok',    color: '#010101', bg: '#F0F0F0', endpoint: '/api/ads/tiktok'    },
  { id: 'microsoft', label: 'Microsoft', color: '#00A4EF', bg: '#E5F5FD', endpoint: '/api/ads/microsoft' },
  { id: 'youtube',   label: 'YouTube',   color: '#FF0000', bg: '#FFF0F0', endpoint: '/api/ads/youtube'   },
]

export const DATE_RANGES = [
  { id: 'yesterday',    label: 'Yesterday' },
  { id: 'last_7_days',  label: '7 Days'    },
  { id: 'last_30_days', label: '30 Days'   },
  { id: 'last_90_days', label: '90 Days'   },
]

export const OBJECTIVES = [
  { id: 'AWARENESS',   label: 'Brand Awareness' },
  { id: 'TRAFFIC',     label: 'Website Traffic' },
  { id: 'CONVERSIONS', label: 'Conversions'     },
  { id: 'LEAD_GEN',    label: 'Lead Generation' },
]

export const AUDIENCE_PRESETS = [
  { id: 'athletic_directors', label: 'Athletic Directors', desc: 'K-12 ADs and sports decision makers' },
  { id: 'coaches',            label: 'Coaches & Staff',    desc: 'Head and assistant coaches'          },
  { id: 'school_admins',      label: 'School Admins',      desc: 'Principals and procurement staff'    },
  { id: 'custom',             label: 'Custom Audience',    desc: 'Define your own targeting'           },
]

// ─── SHARED ATOMS ─────────────────────────────────────────────────────────────
const LABEL = { fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, display: 'block', marginBottom: 4 }
const INP   = { width: '100%', background: B.surface, border: `1px solid ${B.border}`, borderRadius: 6, padding: '9px 12px', fontSize: 12, fontFamily: "'Lexend',sans-serif", color: B.text, outline: 'none', boxSizing: 'border-box' }

function Card({ children, style }) {
  return <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,.05)', ...style }}>{children}</div>
}

function PlatformBadge({ platform, size = 'md' }) {
  const p = PLATFORMS.find(p => p.id === platform)
  if (!p) return null
  const pad = size === 'sm' ? '2px 7px' : '4px 10px'
  const fs  = size === 'sm' ? 9 : 10
  return (
    <span style={{ background: p.bg, color: p.color, border: `1px solid ${p.color}30`, borderRadius: 4, padding: pad, fontSize: fs, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.3, display: 'inline-block' }}>
      {p.label.toUpperCase()}
    </span>
  )
}

function ConnectionStatus({ connected, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? B.green : B.gray2, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: connected ? B.text : B.muted }}>{label}</span>
      {!connected && <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.gray2 }}>— needs API key</span>}
    </div>
  )
}

// ─── TAB BAR ─────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'dashboard',   label: 'Dashboard'       },
  { id: 'creator',     label: 'Ad Creator'      },
  { id: 'campaigns',   label: 'Campaigns'       },
  { id: 'create',      label: 'Create Campaign' },
  { id: 'attribution', label: 'Attribution'     },
  { id: 'utm',         label: 'UTM Builder'     },
  { id: 'alerts',      label: 'Alerts'          },
]

function TabBar({ active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, background: B.surface, borderRadius: 8, padding: 3, border: `1px solid ${B.border}`, marginBottom: 20, alignSelf: 'flex-start' }}>
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            background:  active === t.id ? B.white  : 'transparent',
            color:       active === t.id ? B.orange : B.muted,
            border:      active === t.id ? `1px solid ${B.border}` : '1px solid transparent',
            borderRadius: 6,
            padding:     '7px 18px',
            fontSize:    10,
            fontFamily:  "'Lexend Zetta',sans-serif",
            letterSpacing: 0.5,
            cursor:      'pointer',
            boxShadow:   active === t.id ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
            transition:  'all .12s',
          }}
        >
          {t.label.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

// ─── PLATFORM FILTER ──────────────────────────────────────────────────────────
function PlatformFilter({ selected, onChange }) {
  function toggle(id) {
    onChange(selected.includes(id) ? selected.filter(p => p !== id) : [...selected, id])
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, marginRight: 4 }}>PLATFORMS</span>
      {PLATFORMS.map(p => {
        const on = selected.includes(p.id)
        return (
          <button
            key={p.id}
            onClick={() => toggle(p.id)}
            style={{
              background:  on ? p.bg        : B.surface,
              color:       on ? p.color     : B.muted,
              border:      on ? `1px solid ${p.color}50` : `1px solid ${B.border}`,
              borderRadius: 5,
              padding:     '4px 11px',
              fontSize:    10,
              fontFamily:  "'Lexend Zetta',sans-serif",
              letterSpacing: 0.3,
              cursor:      'pointer',
              transition:  'all .12s',
            }}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── DATE RANGE PICKER ───────────────────────────────────────────────────────
function DateRangePicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {DATE_RANGES.map(r => (
        <button
          key={r.id}
          onClick={() => onChange(r.id)}
          style={{
            background:  value === r.id ? B.orange  : B.surface,
            color:       value === r.id ? B.white   : B.muted,
            border:      value === r.id ? 'none'    : `1px solid ${B.border}`,
            borderRadius: 5,
            padding:     '4px 12px',
            fontSize:    10,
            fontFamily:  "'Lexend Zetta',sans-serif",
            letterSpacing: 0.3,
            cursor:      'pointer',
            transition:  'all .12s',
          }}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

// ─── CONTROLS BAR ────────────────────────────────────────────────────────────
function ControlsBar({ platforms, onPlatforms, dateRange, onDateRange }) {
  return (
    <Card style={{ marginBottom: 16, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <PlatformFilter selected={platforms} onChange={onPlatforms} />
        <DateRangePicker value={dateRange} onChange={onDateRange} />
      </div>
    </Card>
  )
}

// ─── PLACEHOLDER TABS (stubs — replaced in subsequent builds) ─────────────────
// ─── DATA FETCHING ────────────────────────────────────────────────────────────
async function fetchPlatformInsights(pid, dateRange) {
  const p   = PLATFORMS.find(x => x.id === pid)
  const res = await fetch(`${p.endpoint}?action=insights&dateRange=${dateRange}&level=campaign`)
  if (!res.ok) throw new Error(`${p.label} returned ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return Array.isArray(data) ? data : []
}

async function fetchAllInsights(platforms, dateRange) {
  const results = await Promise.allSettled(
    platforms.map(pid => fetchPlatformInsights(pid, dateRange).then(rows => ({ pid, rows })))
  )
  const rows   = []
  const errors = {}
  for (const r of results) {
    if (r.status === 'fulfilled') rows.push(...r.value.rows)
    else {
      const pid = platforms[results.indexOf(r)]
      errors[pid] = r.reason?.message || 'Failed'
    }
  }
  return { rows, errors }
}

function aggregate(rows) {
  const spend       = rows.reduce((s, r) => s + (r.spend       || 0), 0)
  const revenue     = rows.reduce((s, r) => s + (r.revenue     || 0), 0)
  const impressions = rows.reduce((s, r) => s + (r.impressions || 0), 0)
  const clicks      = rows.reduce((s, r) => s + (r.clicks      || 0), 0)
  return {
    spend,
    revenue,
    roas:        spend > 0 ? revenue / spend : 0,
    impressions,
    clicks,
    ctr:         impressions > 0 ? (clicks / impressions) * 100 : 0,
  }
}

function byPlatform(rows) {
  const map = {}
  for (const r of rows) {
    if (!map[r.platform]) map[r.platform] = { spend: 0, revenue: 0, impressions: 0, clicks: 0 }
    map[r.platform].spend       += r.spend       || 0
    map[r.platform].revenue     += r.revenue     || 0
    map[r.platform].impressions += r.impressions || 0
    map[r.platform].clicks      += r.clicks      || 0
  }
  return map
}

// ─── FORMATTERS ───────────────────────────────────────────────────────────────
const fmtUsd  = v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`
const fmtNum  = v => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(Math.round(v))
const fmtRoas = v => `${v.toFixed(2)}x`
const fmtPct  = v => `${v.toFixed(2)}%`

// ─── SORT HOOK ────────────────────────────────────────────────────────────────
function useSortedRows(rows) {
  const [sortKey, setSortKey] = useState('spend')
  const [sortDir, setSortDir] = useState('desc')

  function handleSort(key) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? 0
    const bv = b[sortKey] ?? 0
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
    return sortDir === 'desc' ? -cmp : cmp
  })

  return { sorted, sortKey, sortDir, handleSort }
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, highlight }) {
  return (
    <div style={{ background: highlight ? B.orangeBg : B.surface, borderRadius: 8, padding: '14px 12px', border: `1px solid ${highlight ? B.orange + '40' : B.border}` }}>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: highlight ? B.orange : B.muted, letterSpacing: 1.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 20, color: highlight ? B.orange : B.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ─── TABLE HEADER ─────────────────────────────────────────────────────────────
function Th({ label, sortKey, active, dir, onSort, align = 'right' }) {
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{ padding: '8px 10px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: active ? B.orange : B.muted, letterSpacing: 1.5, cursor: 'pointer', textAlign: align, whiteSpace: 'nowrap', userSelect: 'none' }}
    >
      {label} {active ? (dir === 'desc' ? '↓' : '↑') : ''}
    </th>
  )
}

// ─── PERFORMERS LIST ──────────────────────────────────────────────────────────
function PerformersList({ rows, title, color }) {
  return (
    <div>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 10 }}>{title}</div>
      {rows.length === 0
        ? <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2 }}>No data yet</div>
        : rows.map((r, i) => (
            <div key={r.id + i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 10px', background: B.surface, borderRadius: 6, border: `1px solid ${B.border}` }}>
              <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: color, minWidth: 18 }}>{i + 1}</span>
              <PlatformBadge platform={r.platform} size="sm" />
              <span style={{ flex: 1, fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: color, flexShrink: 0 }}>{fmtRoas(r.roas)}</span>
            </div>
          ))
      }
    </div>
  )
}

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
function exportCsv(rows, filename) {
  if (!rows.length) return
  const keys = ['name', 'platform', 'status', 'spend', 'revenue', 'roas', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm']
  const header = keys.join(',')
  const lines  = rows.map(r => keys.map(k => {
    const v = r[k] ?? ''
    return typeof v === 'string' && v.includes(',') ? `"${v}"` : v
  }).join(','))
  const csv  = [header, ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ─── DASHBOARD TAB ────────────────────────────────────────────────────────────
function DashboardTab({ platforms, dateRange, userRole }) {
  const [rows,      setRows]      = useState([])
  const [errors,    setErrors]    = useState({})
  const [loading,   setLoading]   = useState(false)
  const [aiOutput,  setAiOutput]  = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const load = useCallback(async () => {
    if (!platforms.length) return
    setLoading(true)
    const { rows: r, errors: e } = await fetchAllInsights(platforms, dateRange)
    setRows(r); setErrors(e); setLoading(false)
  }, [platforms.join(','), dateRange])

  useEffect(() => { load() }, [load])

  const totals   = aggregate(rows)
  const platMap  = byPlatform(rows)
  const maxSpend = Math.max(...Object.values(platMap).map(p => p.spend), 1)

  const withRoas = rows.filter(r => r.roas > 0)
  const top5     = [...withRoas].sort((a, b) => b.roas - a.roas).slice(0, 5)
  const bottom5  = [...withRoas].sort((a, b) => a.roas - b.roas).slice(0, 5)

  const { sorted, sortKey, sortDir, handleSort } = useSortedRows(rows)

  async function handleAiAnalyze() {
    if (!rows.length) return
    setAiLoading(true); setAiOutput('')
    const summary = [
      `Total spend: ${fmtUsd(totals.spend)}`,
      `Total revenue: ${fmtUsd(totals.revenue)}`,
      `Blended ROAS: ${fmtRoas(totals.roas)}`,
      `Impressions: ${fmtNum(totals.impressions)}`,
      `Clicks: ${fmtNum(totals.clicks)}, CTR: ${fmtPct(totals.ctr)}`,
      `Date range: ${dateRange.replace(/_/g, ' ')}`,
      '',
      'Top 3 campaigns by ROAS:',
      ...top5.slice(0, 3).map(r => `  - ${r.name} (${r.platform}): ROAS ${fmtRoas(r.roas)}, Spend ${fmtUsd(r.spend)}`),
      '',
      'Bottom 3 campaigns by ROAS:',
      ...bottom5.slice(0, 3).map(r => `  - ${r.name} (${r.platform}): ROAS ${fmtRoas(r.roas)}, Spend ${fmtUsd(r.spend)}`),
    ].join('\n')

    try {
      const res = await routeTask({
        task: `Analyze this ad performance data for ST1 Sports and provide specific budget reallocation recommendations, flag underperformers to pause, and identify scaling opportunities:\n\n${summary}`,
        input: '',
        userRole,
      })
      setAiOutput(res.output || '')
    } catch (e) {
      setAiOutput(`Error: ${e.message}`)
    } finally {
      setAiLoading(false)
    }
  }

  const errPlatforms = Object.keys(errors)

  return (
    <div>
      {/* Error banner */}
      {errPlatforms.length > 0 && (
        <div style={{ marginBottom: 12, padding: '9px 14px', background: '#FFF8E6', border: '1px solid #C7780030', borderRadius: 6, fontFamily: "'Lexend',sans-serif", fontSize: 11, color: '#C77800' }}>
          Could not load: {errPlatforms.map(pid => `${PLATFORMS.find(p => p.id === pid)?.label} (${errors[pid]})`).join(' · ')}
        </div>
      )}

      {/* KPI cards */}
      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2 }}>KPI SUMMARY</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {loading && <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted }}>Loading…</span>}
            <button onClick={load} style={{ background: B.surface, color: B.muted, border: `1px solid ${B.border}`, borderRadius: 5, padding: '3px 10px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'pointer' }}>↻ REFRESH</button>
            <button
              onClick={() => exportCsv(rows, `ad-performance-${dateRange}.csv`)}
              disabled={!rows.length}
              style={{ background: rows.length ? B.surface : B.surface, color: rows.length ? B.text : B.gray2, border: `1px solid ${B.border}`, borderRadius: 5, padding: '3px 10px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: rows.length ? 'pointer' : 'default' }}
            >
              ↓ CSV
            </button>
            <button
              onClick={handleAiAnalyze}
              disabled={!rows.length || aiLoading}
              style={{ background: rows.length ? B.orange : B.gray2, color: B.white, border: 'none', borderRadius: 5, padding: '4px 12px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: rows.length ? 'pointer' : 'default' }}
            >
              {aiLoading ? 'ANALYZING…' : '✦ AI ANALYZE'}
            </button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
          <KpiCard label="TOTAL SPEND"   value={loading ? '…' : fmtUsd(totals.spend)}       />
          <KpiCard label="REVENUE"       value={loading ? '…' : fmtUsd(totals.revenue)}     />
          <KpiCard label="BLENDED ROAS"  value={loading ? '…' : fmtRoas(totals.roas)}       highlight={totals.roas >= 2} />
          <KpiCard label="IMPRESSIONS"   value={loading ? '…' : fmtNum(totals.impressions)} />
          <KpiCard label="CLICKS"        value={loading ? '…' : fmtNum(totals.clicks)}      />
          <KpiCard label="CTR"           value={loading ? '…' : fmtPct(totals.ctr)}         />
        </div>
      </Card>

      {/* AI output */}
      {aiOutput && (
        <Card style={{ marginBottom: 12, border: `1px solid ${B.orange}30`, background: B.orangeBg }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.orange, letterSpacing: 2, marginBottom: 10 }}>✦ AI RECOMMENDATIONS</div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiOutput}</div>
        </Card>
      )}

      {/* Platform breakdown + top/bottom performers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Card>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>PLATFORM BREAKDOWN</div>
          {platforms.length === 0
            ? <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2 }}>No platforms selected</div>
            : platforms.map(pid => {
                const p    = PLATFORMS.find(x => x.id === pid)
                const data = platMap[pid] || { spend: 0 }
                const pct  = maxSpend > 0 ? (data.spend / maxSpend) * 100 : 0
                return (
                  <div key={pid} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <PlatformBadge platform={pid} size="sm" />
                      <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: data.spend ? B.text : B.gray2 }}>
                        {data.spend ? fmtUsd(data.spend) : '—'}
                      </span>
                    </div>
                    <div style={{ height: 5, background: B.surface, borderRadius: 3, border: `1px solid ${B.border}` }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: p?.color, borderRadius: 3, transition: 'width .4s' }} />
                    </div>
                  </div>
                )
              })
          }
        </Card>
        <Card>
          <PerformersList rows={top5}    title="TOP 5 BY ROAS"    color={B.green} />
        </Card>
        <Card>
          <PerformersList rows={bottom5} title="BOTTOM 5 BY ROAS" color={B.red}   />
        </Card>
      </div>

      {/* Campaign performance table */}
      <Card>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>CAMPAIGN PERFORMANCE</div>
        {rows.length === 0
          ? <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2, padding: '10px 0' }}>
              {loading ? 'Loading data…' : 'No campaign data. Add platform API keys in Tool Manager to populate this table.'}
            </div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${B.border}` }}>
                    <Th label="CAMPAIGN"    sortKey="name"        active={sortKey==='name'}        dir={sortDir} onSort={handleSort} align="left" />
                    <Th label="PLATFORM"   sortKey="platform"    active={sortKey==='platform'}    dir={sortDir} onSort={handleSort} align="left" />
                    <Th label="SPEND"      sortKey="spend"       active={sortKey==='spend'}       dir={sortDir} onSort={handleSort} />
                    <Th label="REVENUE"    sortKey="revenue"     active={sortKey==='revenue'}     dir={sortDir} onSort={handleSort} />
                    <Th label="ROAS"       sortKey="roas"        active={sortKey==='roas'}        dir={sortDir} onSort={handleSort} />
                    <Th label="IMPR"       sortKey="impressions" active={sortKey==='impressions'} dir={sortDir} onSort={handleSort} />
                    <Th label="CLICKS"     sortKey="clicks"      active={sortKey==='clicks'}      dir={sortDir} onSort={handleSort} />
                    <Th label="CTR"        sortKey="ctr"         active={sortKey==='ctr'}         dir={sortDir} onSort={handleSort} />
                    <Th label="CPC"        sortKey="cpc"         active={sortKey==='cpc'}         dir={sortDir} onSort={handleSort} />
                    <Th label="CPM"        sortKey="cpm"         active={sortKey==='cpm'}         dir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr key={r.id + i} style={{ borderBottom: `1px solid ${B.border}`, background: i % 2 === 0 ? B.white : B.surface }}>
                      <td style={{ padding: '9px 10px', fontFamily: "'Lexend',sans-serif", color: B.text, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                      <td style={{ padding: '9px 10px' }}><PlatformBadge platform={r.platform} size="sm" /></td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.text }}>{fmtUsd(r.spend)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.text }}>{fmtUsd(r.revenue)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 10, color: r.roas >= 2 ? B.green : r.roas > 0 ? B.text : B.gray2 }}>{fmtRoas(r.roas)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.muted }}>{fmtNum(r.impressions)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.muted }}>{fmtNum(r.clicks)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.muted }}>{fmtPct(r.ctr)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.muted }}>{fmtUsd(r.cpc)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.muted }}>{fmtUsd(r.cpm)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Card>
    </div>
  )
}

// ─── CAMPAIGNS TAB ───────────────────────────────────────────────────────────
async function fetchAllCampaigns(platforms) {
  const results = await Promise.allSettled(
    platforms.map(pid => {
      const p = PLATFORMS.find(x => x.id === pid)
      return fetch(`${p.endpoint}?action=campaigns`)
        .then(r => r.json())
        .then(data => {
          if (data.error) throw new Error(data.error)
          return Array.isArray(data) ? data : []
        })
    })
  )
  const campaigns = []
  const errors    = {}
  platforms.forEach((pid, i) => {
    if (results[i].status === 'fulfilled') campaigns.push(...results[i].value)
    else errors[pid] = results[i].reason?.message || 'Failed'
  })
  return { campaigns, errors }
}

async function campaignAction(pid, body) {
  const p = PLATFORMS.find(x => x.id === pid)
  const r = await fetch(p.endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const d = await r.json()
  if (d.error) throw new Error(d.error)
  return d
}

function statusColor(status = '') {
  const s = status.toUpperCase()
  if (s === 'ACTIVE' || s === 'ENABLED' || s === 'ENABLE') return B.green
  if (s === 'PAUSED' || s === 'PAUSE'   || s === 'DISABLE') return '#C77800'
  return B.gray2
}

function StatusBadge({ status }) {
  const label = (status || 'UNKNOWN').replace(/_/g, ' ')
  return (
    <span style={{
      fontFamily:    "'Lexend Zetta',sans-serif",
      fontSize:      7,
      letterSpacing: 1,
      color:         statusColor(status),
      background:    statusColor(status) + '18',
      border:        `1px solid ${statusColor(status)}40`,
      borderRadius:  4,
      padding:       '2px 7px',
    }}>
      {label}
    </span>
  )
}

function BudgetEditor({ campaign, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState(String(campaign.dailyBudget ?? ''))
  const [saving,  setSaving]  = useState(false)
  const [err,     setErr]     = useState('')

  async function save() {
    const num = parseFloat(value)
    if (isNaN(num) || num <= 0) { setErr('Invalid'); return }
    setSaving(true); setErr('')
    try {
      await onSave(num)
      setEditing(false)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  if (!editing) return (
    <button
      onClick={() => setEditing(true)}
      style={{ background: 'none', border: 'none', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: campaign.dailyBudget ? B.text : B.gray2, cursor: 'pointer', padding: 0, textDecoration: 'underline dotted' }}
    >
      {campaign.dailyBudget ? `$${campaign.dailyBudget.toFixed(0)}/day` : '—'}
    </button>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        style={{ width: 70, padding: '3px 6px', fontFamily: "'Lexend',sans-serif", fontSize: 11, border: `1px solid ${err ? B.red : B.orange}`, borderRadius: 4, outline: 'none' }}
      />
      <button onClick={save} disabled={saving} style={{ background: B.orange, color: B.white, border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 9, cursor: 'pointer' }}>
        {saving ? '…' : '✓'}
      </button>
      <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: B.muted, cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
    </div>
  )
}

function DrillDown({ campaign, dateRange }) {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState('')

  useEffect(() => {
    const p = PLATFORMS.find(x => x.id === campaign.platform)
    if (!p) { setLoading(false); return }
    fetch(`${p.endpoint}?action=insights&level=adset&dateRange=${dateRange}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setRows(Array.isArray(d) ? d : [])
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [campaign.id, dateRange])

  if (loading) return <div style={{ padding: '12px 16px', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted }}>Loading ad sets…</div>
  if (err)     return <div style={{ padding: '12px 16px', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.red }}>{err}</div>
  if (!rows.length) return <div style={{ padding: '12px 16px', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2 }}>No ad set data available.</div>

  return (
    <div style={{ padding: '10px 16px 14px', background: B.surface, borderTop: `1px solid ${B.border}` }}>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, marginBottom: 8 }}>AD SETS</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${B.border}` }}>
            {['Ad Set', 'Spend', 'Revenue', 'ROAS', 'Impressions', 'Clicks', 'CTR'].map(h => (
              <th key={h} style={{ padding: '5px 8px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1, textAlign: h === 'Ad Set' ? 'left' : 'right' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id + i} style={{ borderBottom: `1px solid ${B.border}` }}>
              <td style={{ padding: '7px 8px', fontFamily: "'Lexend',sans-serif", color: B.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.text }}>{fmtUsd(r.spend)}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.text }}>{fmtUsd(r.revenue)}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: r.roas >= 2 ? B.green : B.text }}>{fmtRoas(r.roas)}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.muted }}>{fmtNum(r.impressions)}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.muted }}>{fmtNum(r.clicks)}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: "'Lexend',sans-serif", color: B.muted }}>{fmtPct(r.ctr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CampaignRow({ campaign, dateRange, onRefresh }) {
  const [expanded, setExpanded] = useState(false)
  const [acting,   setActing]   = useState(false)
  const [flash,    setFlash]    = useState('')

  const isActive = ['ACTIVE', 'ENABLED', 'ENABLE'].includes((campaign.status || '').toUpperCase())

  async function doAction(action, extra = {}) {
    setActing(true); setFlash('')
    try {
      await campaignAction(campaign.platform, { action, id: campaign.id, ...extra })
      setFlash(action === 'pause' ? 'Paused' : action === 'resume' ? 'Resumed' : 'Updated')
      setTimeout(() => { setFlash(''); onRefresh() }, 1200)
    } catch (e) {
      setFlash(`Error: ${e.message}`)
    } finally {
      setActing(false)
    }
  }

  return (
    <div style={{ border: `1px solid ${B.border}`, borderRadius: 8, overflow: 'hidden', background: B.white }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px' }}>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{ background: 'none', border: 'none', color: B.muted, cursor: 'pointer', fontSize: 11, padding: 0, flexShrink: 0, width: 16, textAlign: 'center' }}
        >
          {expanded ? '▾' : '▸'}
        </button>

        <PlatformBadge platform={campaign.platform} size="sm" />

        <span style={{ flex: 1, fontFamily: "'Lexend',sans-serif", fontSize: 12, fontWeight: 500, color: B.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {campaign.name}
        </span>

        <StatusBadge status={campaign.status} />

        <BudgetEditor
          campaign={campaign}
          onSave={v => doAction('set_budget', { dailyBudget: v })}
        />

        {flash
          ? <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: flash.startsWith('Error') ? B.red : B.green, minWidth: 70 }}>{flash}</span>
          : (
            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
              {isActive
                ? (
                  <button
                    onClick={() => doAction('pause')}
                    disabled={acting}
                    style={{ background: '#FFF8E6', color: '#C77800', border: '1px solid #C7780030', borderRadius: 5, padding: '4px 10px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.3, cursor: 'pointer' }}
                  >
                    PAUSE
                  </button>
                ) : (
                  <button
                    onClick={() => doAction('resume')}
                    disabled={acting}
                    style={{ background: B.greenBg, color: B.green, border: `1px solid ${B.green}30`, borderRadius: 5, padding: '4px 10px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.3, cursor: 'pointer' }}
                  >
                    RESUME
                  </button>
                )
              }
            </div>
          )
        }
      </div>

      {expanded && <DrillDown campaign={campaign} dateRange={dateRange} />}
    </div>
  )
}

function CampaignsTab({ platforms, dateRange }) {
  const [campaigns, setCampaigns] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [errors,    setErrors]    = useState({})
  const [filter,    setFilter]    = useState('all')   // all | active | paused

  const load = useCallback(async () => {
    if (!platforms.length) return
    setLoading(true)
    const { campaigns: c, errors: e } = await fetchAllCampaigns(platforms)
    setCampaigns(c); setErrors(e); setLoading(false)
  }, [platforms.join(',')])

  useEffect(() => { load() }, [load])

  const filtered = filter === 'all'
    ? campaigns
    : campaigns.filter(c => {
        const s = (c.status || '').toUpperCase()
        return filter === 'active' ? ['ACTIVE', 'ENABLED'].includes(s) : ['PAUSED', 'DISABLE', 'DISABLED'].includes(s)
      })

  const errPlatforms = Object.keys(errors)

  return (
    <div>
      {errPlatforms.length > 0 && (
        <div style={{ marginBottom: 12, padding: '9px 14px', background: '#FFF8E6', border: '1px solid #C7780030', borderRadius: 6, fontFamily: "'Lexend',sans-serif", fontSize: 11, color: '#C77800' }}>
          Could not load: {errPlatforms.map(pid => `${PLATFORMS.find(p => p.id === pid)?.label} (${errors[pid]})`).join(' · ')}
        </div>
      )}

      <Card style={{ marginBottom: 12, padding: '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* Status filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[['all', 'ALL'], ['active', 'ACTIVE'], ['paused', 'PAUSED']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                style={{
                  background:  filter === id ? B.orange : B.surface,
                  color:       filter === id ? B.white  : B.muted,
                  border:      filter === id ? 'none'   : `1px solid ${B.border}`,
                  borderRadius: 5, padding: '4px 12px', fontSize: 9,
                  fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'pointer',
                }}
              >
                {label} {id === 'all' ? `(${campaigns.length})` : id === 'active' ? `(${campaigns.filter(c => ['ACTIVE','ENABLED'].includes((c.status||'').toUpperCase())).length})` : `(${campaigns.filter(c => ['PAUSED','DISABLE','DISABLED'].includes((c.status||'').toUpperCase())).length})`}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            style={{ background: B.surface, color: B.muted, border: `1px solid ${B.border}`, borderRadius: 5, padding: '4px 10px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'pointer' }}
          >
            {loading ? '…' : '↻ REFRESH'}
          </button>
        </div>
      </Card>

      {loading && !campaigns.length
        ? <Card><div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted }}>Loading campaigns…</div></Card>
        : filtered.length === 0
        ? <Card><div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2 }}>No campaigns found. Connect platforms to see your campaigns here.</div></Card>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map((c, i) => (
              <CampaignRow key={c.id + c.platform + i} campaign={c} dateRange={dateRange} onRefresh={load} />
            ))}
          </div>
        )
      }
    </div>
  )
}

// ─── CREATE CAMPAIGN WIZARD ───────────────────────────────────────────────────
const STEPS = ['Name + Objective', 'Audience', 'Creative', 'Budget + Schedule', 'Launch']
const CTAS  = ['Learn More', 'Shop Now', 'Get a Quote', 'Contact Us', 'Sign Up', 'Download']

const EMPTY_CAMPAIGN = {
  name:       '',
  objective:  'CONVERSIONS',
  audience:   'athletic_directors',
  customAudience: '',
  headline:   '',
  body:       '',
  cta:        'Get a Quote',
  imageUrl:   '',
  dailyBudget: 50,
  startDate:  new Date().toISOString().slice(0, 10),
  endDate:    '',
  platforms:  ['meta'],
}

function StepIndicator({ current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
      {STEPS.map((label, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: i < current ? B.green : i === current ? B.orange : B.surface,
              border: `2px solid ${i < current ? B.green : i === current ? B.orange : B.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9,
              color: i <= current ? B.white : B.muted,
              flexShrink: 0,
            }}>
              {i < current ? '✓' : i + 1}
            </div>
            <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: i === current ? B.orange : B.muted, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
              {label.toUpperCase()}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ flex: 1, height: 2, background: i < current ? B.green : B.border, margin: '0 6px', marginBottom: 18 }} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

function FieldBlock({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  )
}

function WizardInput(props) {
  return <input style={{ ...INP, boxSizing: 'border-box' }} {...props} />
}
function WizardTextarea(props) {
  return <textarea style={{ ...INP, resize: 'vertical', minHeight: 72, boxSizing: 'border-box' }} {...props} />
}
function WizardSelect({ children, ...props }) {
  return <select style={{ ...INP, cursor: 'pointer', boxSizing: 'border-box' }} {...props}>{children}</select>
}

function ObjectiveCard({ id, label, desc, selected, onSelect }) {
  return (
    <div
      onClick={() => onSelect(id)}
      style={{
        border:     `2px solid ${selected ? B.orange : B.border}`,
        background: selected ? B.orangeBg : B.white,
        borderRadius: 8, padding: '12px 14px', cursor: 'pointer', transition: 'all .12s',
      }}
    >
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: selected ? B.orange : B.text, letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted }}>{desc}</div>
    </div>
  )
}

function AudienceCard({ preset, selected, onSelect }) {
  return (
    <div
      onClick={() => onSelect(preset.id)}
      style={{
        border:     `2px solid ${selected ? B.orange : B.border}`,
        background: selected ? B.orangeBg : B.white,
        borderRadius: 8, padding: '12px 14px', cursor: 'pointer', transition: 'all .12s',
      }}
    >
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: selected ? B.orange : B.text, letterSpacing: 0.5, marginBottom: 3 }}>{preset.label}</div>
      <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted }}>{preset.desc}</div>
    </div>
  )
}

function Step1({ campaign, onChange }) {
  return (
    <div>
      <FieldBlock label="CAMPAIGN NAME *">
        <WizardInput
          value={campaign.name}
          onChange={e => onChange('name', e.target.value)}
          placeholder="e.g. Fall 2025 Baseball — Athletic Directors"
        />
      </FieldBlock>
      <FieldBlock label="OBJECTIVE">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {OBJECTIVES.map(o => (
            <ObjectiveCard
              key={o.id}
              id={o.id}
              label={o.label}
              desc={{ AWARENESS: 'Maximize reach and brand recall', TRAFFIC: 'Drive clicks to your website', CONVERSIONS: 'Generate orders and leads', LEAD_GEN: 'Capture contact info on-platform' }[o.id]}
              selected={campaign.objective === o.id}
              onSelect={v => onChange('objective', v)}
            />
          ))}
        </div>
      </FieldBlock>
    </div>
  )
}

function Step2({ campaign, onChange }) {
  return (
    <div>
      <FieldBlock label="AUDIENCE PRESET">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {AUDIENCE_PRESETS.map(p => (
            <AudienceCard
              key={p.id}
              preset={p}
              selected={campaign.audience === p.id}
              onSelect={v => onChange('audience', v)}
            />
          ))}
        </div>
      </FieldBlock>
      {campaign.audience === 'custom' && (
        <FieldBlock label="CUSTOM TARGETING NOTES">
          <WizardTextarea
            value={campaign.customAudience}
            onChange={e => onChange('customAudience', e.target.value)}
            placeholder="Describe your target audience — job titles, locations, interests, company size…"
            rows={3}
          />
        </FieldBlock>
      )}
    </div>
  )
}

function Step3({ campaign, onChange, userRole }) {
  const [generating, setGenerating] = useState(false)

  async function generateCopy() {
    setGenerating(true)
    try {
      const audience = AUDIENCE_PRESETS.find(p => p.id === campaign.audience)?.label || campaign.audience
      const obj      = OBJECTIVES.find(o => o.id === campaign.objective)?.label      || campaign.objective
      const res = await routeTask({
        task: `Write a short ad for ST1 Sports. Campaign: "${campaign.name}". Objective: ${obj}. Audience: ${audience} at K-12 schools. Return JSON with exactly: {"headline": "...", "body": "..."}. Headline under 40 chars, body under 125 chars. Direct, benefit-focused.`,
        input: '', userRole,
      })
      try {
        const raw  = res.output?.match(/\{[\s\S]*\}/)?.[0]
        const json = JSON.parse(raw)
        if (json.headline) onChange('headline', json.headline)
        if (json.body)     onChange('body',     json.body)
      } catch {}
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          onClick={generateCopy}
          disabled={generating || !campaign.name}
          style={{ background: generating || !campaign.name ? B.gray2 : B.orange, color: B.white, border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: generating || !campaign.name ? 'default' : 'pointer' }}
        >
          {generating ? 'GENERATING…' : '✦ AI GENERATE COPY'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <FieldBlock label="HEADLINE *">
          <WizardInput
            value={campaign.headline}
            onChange={e => onChange('headline', e.target.value)}
            placeholder="e.g. Outfit Your Team for Less"
            maxLength={40}
          />
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted, marginTop: 3 }}>{campaign.headline.length}/40 chars</div>
        </FieldBlock>
        <FieldBlock label="CALL TO ACTION">
          <WizardSelect value={campaign.cta} onChange={e => onChange('cta', e.target.value)}>
            {CTAS.map(c => <option key={c} value={c}>{c}</option>)}
          </WizardSelect>
        </FieldBlock>
      </div>
      <FieldBlock label="BODY COPY *">
        <WizardTextarea
          value={campaign.body}
          onChange={e => onChange('body', e.target.value)}
          placeholder="e.g. ST1 Sports supplies K-12 athletic programs with top brands at tax-exempt pricing. Wilson, DeMarini, Louisville Slugger and more."
          rows={3}
          maxLength={125}
        />
        <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted, marginTop: 3 }}>{campaign.body.length}/125 chars</div>
      </FieldBlock>
      <FieldBlock label="IMAGE URL (OPTIONAL — paste from Image Generator)">
        <WizardInput
          value={campaign.imageUrl}
          onChange={e => onChange('imageUrl', e.target.value)}
          placeholder="https://…"
        />
      </FieldBlock>
      {campaign.imageUrl && (
        <img
          src={campaign.imageUrl}
          alt="Ad creative preview"
          style={{ maxWidth: 280, maxHeight: 160, borderRadius: 8, border: `1px solid ${B.border}`, marginTop: 4 }}
          onError={e => { e.target.style.display = 'none' }}
        />
      )}
    </div>
  )
}

function Step4({ campaign, onChange }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FieldBlock label="DAILY BUDGET (USD) *">
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.muted }}>$</span>
            <WizardInput
              type="number"
              min="1"
              value={campaign.dailyBudget}
              onChange={e => onChange('dailyBudget', parseFloat(e.target.value) || 0)}
              style={{ ...INP, paddingLeft: 22, boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted, marginTop: 4 }}>
            Monthly est. ${(campaign.dailyBudget * 30).toLocaleString()}
          </div>
        </FieldBlock>
        <FieldBlock label="LIFETIME BUDGET (OPTIONAL)">
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.muted }}>$</span>
            <WizardInput
              type="number"
              min="1"
              placeholder="No cap"
              style={{ ...INP, paddingLeft: 22, boxSizing: 'border-box' }}
            />
          </div>
        </FieldBlock>
        <FieldBlock label="START DATE *">
          <WizardInput
            type="date"
            value={campaign.startDate}
            onChange={e => onChange('startDate', e.target.value)}
          />
        </FieldBlock>
        <FieldBlock label="END DATE (OPTIONAL)">
          <WizardInput
            type="date"
            value={campaign.endDate}
            min={campaign.startDate}
            onChange={e => onChange('endDate', e.target.value)}
          />
        </FieldBlock>
      </div>
      <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: '12px 14px', marginTop: 6 }}>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, marginBottom: 8 }}>BUDGET SUMMARY</div>
        <div style={{ display: 'flex', gap: 24 }}>
          <div>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1 }}>DAILY</div>
            <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, color: B.orange }}>${campaign.dailyBudget}</div>
          </div>
          <div>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1 }}>30-DAY EST.</div>
            <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, color: B.text }}>${(campaign.dailyBudget * 30).toLocaleString()}</div>
          </div>
          {campaign.endDate && campaign.startDate && (
            <div>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1 }}>CAMPAIGN TOTAL EST.</div>
              <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, color: B.text }}>
                ${(campaign.dailyBudget * Math.max(1, Math.ceil((new Date(campaign.endDate) - new Date(campaign.startDate)) / 86400000))).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Step5({ campaign, onChange, onLaunch, launching, launchResults }) {
  function togglePlatform(pid) {
    const current = campaign.platforms
    onChange('platforms', current.includes(pid) ? current.filter(p => p !== pid) : [...current, pid])
  }

  return (
    <div>
      <FieldBlock label="SELECT PLATFORMS TO LAUNCH ON">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
          {PLATFORMS.map(p => {
            const on     = campaign.platforms.includes(p.id)
            const result = launchResults[p.id]
            return (
              <div
                key={p.id}
                onClick={() => !result && togglePlatform(p.id)}
                style={{
                  border:     `2px solid ${result?.ok ? B.green : result?.err ? B.red : on ? p.color : B.border}`,
                  background: result?.ok ? B.greenBg : result?.err ? B.redBg : on ? p.bg : B.white,
                  borderRadius: 8, padding: '12px 14px',
                  cursor:     result ? 'default' : 'pointer',
                  transition: 'all .12s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: on ? p.color : B.muted, letterSpacing: 0.5 }}>{p.label.toUpperCase()}</span>
                  <span style={{ fontSize: 14 }}>
                    {result?.ok ? '✓' : result?.err ? '✗' : on ? '●' : '○'}
                  </span>
                </div>
                {result?.err && <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.red }}>{result.err}</div>}
                {result?.ok  && <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.green }}>Launched (paused for review)</div>}
              </div>
            )
          })}
        </div>
      </FieldBlock>

      <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: '12px 14px', marginBottom: 18 }}>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, marginBottom: 8 }}>REVIEW BEFORE LAUNCH</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontFamily: "'Lexend',sans-serif", fontSize: 11 }}>
          <div><span style={{ color: B.muted }}>Name: </span><strong>{campaign.name || '—'}</strong></div>
          <div><span style={{ color: B.muted }}>Objective: </span><strong>{OBJECTIVES.find(o => o.id === campaign.objective)?.label}</strong></div>
          <div><span style={{ color: B.muted }}>Audience: </span><strong>{AUDIENCE_PRESETS.find(a => a.id === campaign.audience)?.label}</strong></div>
          <div><span style={{ color: B.muted }}>Daily Budget: </span><strong>${campaign.dailyBudget}/day</strong></div>
          <div><span style={{ color: B.muted }}>Start: </span><strong>{campaign.startDate || '—'}</strong></div>
          <div><span style={{ color: B.muted }}>End: </span><strong>{campaign.endDate || 'No end date'}</strong></div>
          <div><span style={{ color: B.muted }}>Headline: </span><strong>{campaign.headline || '—'}</strong></div>
          <div><span style={{ color: B.muted }}>CTA: </span><strong>{campaign.cta}</strong></div>
        </div>
      </div>

      <div style={{ background: '#FFF8E6', border: '1px solid #C7780030', borderRadius: 6, padding: '9px 14px', marginBottom: 16, fontFamily: "'Lexend',sans-serif", fontSize: 11, color: '#C77800' }}>
        Campaigns launch in <strong>PAUSED</strong> state for review. Activate them from the Campaigns tab after confirming settings in each platform.
      </div>

      <button
        onClick={onLaunch}
        disabled={launching || !campaign.platforms.length || !campaign.name || !campaign.headline || !campaign.body}
        style={{
          background:  launching || !campaign.platforms.length || !campaign.name || !campaign.headline || !campaign.body ? B.gray2 : B.orange,
          color:       B.white, border: 'none', borderRadius: 6,
          padding:     '11px 28px', fontSize: 11,
          fontFamily:  "'Lexend Zetta',sans-serif", letterSpacing: 0.5,
          cursor:      launching ? 'default' : 'pointer',
        }}
      >
        {launching ? 'LAUNCHING…' : `LAUNCH ON ${campaign.platforms.length} PLATFORM${campaign.platforms.length !== 1 ? 'S' : ''} →`}
      </button>
    </div>
  )
}

function CreateTab({ userRole, onSwitchToTab }) {
  const [step,          setStep]          = useState(0)
  const [campaign,      setCampaign]      = useState(EMPTY_CAMPAIGN)
  const [launching,     setLaunching]     = useState(false)
  const [launchResults, setLaunchResults] = useState({})
  const [launched,      setLaunched]      = useState(false)

  function update(key, value) {
    setCampaign(c => ({ ...c, [key]: value }))
  }

  function canAdvance() {
    if (step === 0) return campaign.name.trim().length > 0
    if (step === 2) return campaign.headline.trim().length > 0 && campaign.body.trim().length > 0
    if (step === 3) return campaign.dailyBudget > 0 && campaign.startDate
    return true
  }

  async function launch() {
    setLaunching(true)
    const results = {}
    await Promise.allSettled(
      campaign.platforms.map(async pid => {
        const p = PLATFORMS.find(x => x.id === pid)
        try {
          const r = await fetch(p.endpoint, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'create', campaign }),
          })
          const d = await r.json()
          if (d.error) throw new Error(d.error)
          results[pid] = { ok: true, data: d }
        } catch (e) {
          results[pid] = { err: e.message }
        }
      })
    )
    setLaunchResults(results)
    setLaunching(false)
    const anyOk = Object.values(results).some(r => r.ok)
    if (anyOk) setLaunched(true)
  }

  function reset() {
    setCampaign(EMPTY_CAMPAIGN); setStep(0)
    setLaunchResults({}); setLaunched(false)
  }

  if (launched && Object.keys(launchResults).length) {
    const ok  = Object.entries(launchResults).filter(([, r]) => r.ok)
    const err = Object.entries(launchResults).filter(([, r]) => r.err)
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🚀</div>
          <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 22, color: B.black, marginBottom: 6 }}>Campaign Launched!</div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.muted, marginBottom: 20 }}>
            <strong style={{ color: B.text }}>{campaign.name}</strong> was sent to {ok.length} platform{ok.length !== 1 ? 's' : ''} in PAUSED state.
          </div>
          {ok.length > 0 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: ok.length && err.length ? 12 : 24 }}>
              {ok.map(([pid]) => <PlatformBadge key={pid} platform={pid} />)}
            </div>
          )}
          {err.length > 0 && (
            <div style={{ background: B.redBg, border: `1px solid ${B.red}30`, borderRadius: 6, padding: '9px 14px', marginBottom: 20, textAlign: 'left' }}>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.red, letterSpacing: 1.5, marginBottom: 6 }}>FAILED</div>
              {err.map(([pid, r]) => (
                <div key={pid} style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.red }}>
                  {PLATFORMS.find(p => p.id === pid)?.label}: {r.err}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={reset} style={{ background: B.orange, color: B.white, border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'pointer' }}>CREATE ANOTHER</button>
            <button onClick={() => onSwitchToTab('campaigns')} style={{ background: B.surface, color: B.muted, border: `1px solid ${B.border}`, borderRadius: 6, padding: '9px 16px', fontSize: 10, fontFamily: "'Lexend',sans-serif", cursor: 'pointer' }}>View in Campaigns →</button>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <StepIndicator current={step} />

      <div style={{ minHeight: 280 }}>
        {step === 0 && <Step1 campaign={campaign} onChange={update} />}
        {step === 1 && <Step2 campaign={campaign} onChange={update} />}
        {step === 2 && <Step3 campaign={campaign} onChange={update} userRole={userRole} />}
        {step === 3 && <Step4 campaign={campaign} onChange={update} />}
        {step === 4 && (
          <Step5
            campaign={campaign}
            onChange={update}
            onLaunch={launch}
            launching={launching}
            launchResults={launchResults}
          />
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingTop: 16, borderTop: `1px solid ${B.border}` }}>
        <button
          onClick={() => setStep(s => s - 1)}
          disabled={step === 0}
          style={{ background: B.surface, color: step === 0 ? B.gray2 : B.muted, border: `1px solid ${B.border}`, borderRadius: 6, padding: '8px 18px', fontSize: 10, fontFamily: "'Lexend',sans-serif", cursor: step === 0 ? 'default' : 'pointer' }}
        >
          ← Back
        </button>
        <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted }}>Step {step + 1} of {STEPS.length}</span>
        {step < STEPS.length - 1 && (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!canAdvance()}
            style={{ background: canAdvance() ? B.orange : B.gray2, color: B.white, border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: canAdvance() ? 'pointer' : 'default' }}
          >
            NEXT →
          </button>
        )}
        {step === STEPS.length - 1 && <div />}
      </div>
    </Card>
  )
}

// ─── ATTRIBUTION TAB ──────────────────────────────────────────────────────────
function AttributionTab() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [range,   setRange]   = useState('30')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ads/attribution?dateRange=${range}&limit=100`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData({ records: [], totalRevenue: 0, byPlatform: {}, count: 0 }))
      .finally(() => setLoading(false))
  }, [range])

  const platEntries = data ? Object.entries(data.byPlatform || {}).sort((a, b) => b[1].revenue - a[1].revenue) : []

  return (
    <div>
      <Card style={{ marginBottom: 12, padding: '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5 }}>DATE RANGE</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['7','7 Days'],['30','30 Days'],['90','90 Days']].map(([v, label]) => (
              <button key={v} onClick={() => setRange(v)} style={{ background: range === v ? B.orange : B.surface, color: range === v ? B.white : B.muted, border: range === v ? 'none' : `1px solid ${B.border}`, borderRadius: 5, padding: '4px 12px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.3, cursor: 'pointer' }}>{label}</button>
            ))}
          </div>
        </div>
      </Card>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
        <KpiCard label="TOTAL ATTRIBUTED REVENUE" value={loading ? '…' : `$${(data?.totalRevenue || 0).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})}`} highlight />
        <KpiCard label="ATTRIBUTED DEALS" value={loading ? '…' : String(data?.count || 0)} />
        <KpiCard label="AVG DEAL SIZE" value={loading ? '…' : data?.count > 0 ? `$${((data?.totalRevenue || 0) / data.count).toFixed(0)}` : '—'} />
      </div>

      {/* By platform */}
      {platEntries.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>BY PLATFORM</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {platEntries.map(([pid, p]) => {
              const plat = PLATFORMS.find(x => x.id === pid)
              return (
                <div key={pid} style={{ background: plat?.bg || B.surface, border: `1px solid ${plat?.color || B.border}30`, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: plat?.color || B.muted, letterSpacing: 0.5, marginBottom: 4 }}>{plat?.label || pid}</div>
                  <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 17, color: B.text }}>${(p.revenue || 0).toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                  <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted }}>{p.count} deal{p.count !== 1 ? 's' : ''}</div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Records table */}
      <Card>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>ATTRIBUTION RECORDS</div>
        {loading
          ? <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted }}>Loading…</div>
          : !data?.records?.length
          ? <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2 }}>
              {data?.note || 'No attribution records yet. Attribution records are created when deals are linked to ad campaigns.'}
            </div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${B.border}` }}>
                    {['Platform','Contact','Revenue','Type','Converted'].map(h => (
                      <th key={h} style={{ padding: '7px 10px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1, textAlign: h === 'Revenue' ? 'right' : 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((r, i) => (
                    <tr key={r.id + i} style={{ borderBottom: `1px solid ${B.border}`, background: i % 2 === 0 ? B.white : B.surface }}>
                      <td style={{ padding: '8px 10px' }}><PlatformBadge platform={r.platform} size="sm" /></td>
                      <td style={{ padding: '8px 10px', fontFamily: "'Lexend',sans-serif", color: B.text }}>{r.contact_email || r.zoho_contact_id || '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 10, color: B.green }}>${parseFloat(r.attributed_revenue || 0).toFixed(0)}</td>
                      <td style={{ padding: '8px 10px', fontFamily: "'Lexend',sans-serif", color: B.muted, fontSize: 10 }}>{r.attribution_type}</td>
                      <td style={{ padding: '8px 10px', fontFamily: "'Lexend',sans-serif", color: B.muted, fontSize: 10 }}>{r.converted_at ? new Date(r.converted_at).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Card>
    </div>
  )
}

// ─── UTM BUILDER TAB ──────────────────────────────────────────────────────────
const UTM_MEDIUMS = ['cpc', 'email', 'social', 'display', 'video', 'referral']
const UTM_SOURCES = ['google', 'facebook', 'instagram', 'linkedin', 'tiktok', 'bing', 'youtube', 'newsletter']

function UTMBuilderTab() {
  const [url,      setUrl]      = useState('')
  const [source,   setSource]   = useState('')
  const [medium,   setMedium]   = useState('')
  const [campaign, setCampaign] = useState('')
  const [content,  setContent]  = useState('')
  const [term,     setTerm]     = useState('')
  const [saved,    setSaved]    = useState([])
  const [copied,   setCopied]   = useState(false)
  const [saving,   setSaving]   = useState(false)

  useEffect(() => {
    fetch('/api/analytics/utm')
      .then(r => r.json())
      .then(d => { if (d.links) setSaved(d.links) })
      .catch(() => {})
  }, [])

  const params = [
    ['utm_source', source],
    ['utm_medium', medium],
    ['utm_campaign', campaign],
    ['utm_content', content],
    ['utm_term', term],
  ].filter(([, v]) => v.trim())

  const built = url.trim() && source.trim() && medium.trim() && campaign.trim()
    ? `${url.trim().replace(/\/$/, '')}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v.trim())}`).join('&')}`
    : ''

  function handleCopy() {
    if (!built) return
    navigator.clipboard.writeText(built).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleSave() {
    if (!built) return
    setSaving(true)
    try {
      const r = await fetch('/api/analytics/utm', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ destination: url.trim(), utm_source: source, utm_medium: medium, utm_campaign: campaign, utm_content: content || undefined, utm_term: term || undefined }),
      })
      const d = await r.json()
      if (d.link) setSaved(s => [d.link, ...s])
    } catch {}
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    await fetch(`/api/analytics/utm?id=${id}`, { method: 'DELETE' }).catch(() => {})
    setSaved(s => s.filter(x => x.id !== id))
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 14 }}>
      <div>
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 14 }}>BUILD UTM LINK</div>
          <div style={{ marginBottom: 12 }}>
            <label style={LABEL}>DESTINATION URL *</label>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://st1sports.com/baseball" style={INP} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={LABEL}>SOURCE *</label>
              <input value={source} onChange={e => setSource(e.target.value)} list="utm-sources" placeholder="google, facebook…" style={INP} />
              <datalist id="utm-sources">{UTM_SOURCES.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label style={LABEL}>MEDIUM *</label>
              <input value={medium} onChange={e => setMedium(e.target.value)} list="utm-mediums" placeholder="cpc, email, social…" style={INP} />
              <datalist id="utm-mediums">{UTM_MEDIUMS.map(s => <option key={s} value={s} />)}</datalist>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={LABEL}>CAMPAIGN *</label>
              <input value={campaign} onChange={e => setCampaign(e.target.value)} placeholder="fall-2025-baseball" style={INP} />
            </div>
            <div>
              <label style={LABEL}>CONTENT</label>
              <input value={content} onChange={e => setContent(e.target.value)} placeholder="banner-v1" style={INP} />
            </div>
            <div>
              <label style={LABEL}>TERM</label>
              <input value={term} onChange={e => setTerm(e.target.value)} placeholder="baseball+equipment" style={INP} />
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 10 }}>GENERATED URL</div>
          {built ? (
            <>
              <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 6, padding: '10px 12px', fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.text, wordBreak: 'break-all', marginBottom: 10, lineHeight: 1.6 }}>
                {built}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleCopy} style={{ background: copied ? B.green : B.orange, color: B.white, border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'pointer', transition: 'background .2s' }}>
                  {copied ? '✓ COPIED' : '↗ COPY'}
                </button>
                <button onClick={handleSave} disabled={saving} style={{ background: saving ? B.gray2 : B.surface, color: saving ? B.white : B.text, border: `1px solid ${B.border}`, borderRadius: 6, padding: '7px 14px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: saving ? 'default' : 'pointer' }}>
                  {saving ? 'SAVING…' : '+ SAVE'}
                </button>
              </div>
            </>
          ) : (
            <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2 }}>Fill in URL, Source, Medium, and Campaign to generate a link.</div>
          )}
        </Card>
      </div>

      <Card>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>SAVED LINKS ({saved.length})</div>
        {saved.length === 0
          ? <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2 }}>No saved links yet. Build and save a link to store it here permanently.</div>
          : saved.map(s => (
            <div key={s.id} style={{ marginBottom: 10, padding: '9px 10px', background: B.surface, borderRadius: 7, border: `1px solid ${B.border}` }}>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.text, letterSpacing: 0.3, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</div>
              <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>{s.full_url || s.url}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => navigator.clipboard.writeText(s.full_url || s.url)} style={{ background: B.orange, color: B.white, border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 8, fontFamily: "'Lexend Zetta',sans-serif", cursor: 'pointer' }}>COPY</button>
                <button onClick={() => handleDelete(s.id)} style={{ background: 'none', color: B.gray2, border: `1px solid ${B.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 8, fontFamily: "'Lexend',sans-serif", cursor: 'pointer' }}>✕</button>
              </div>
            </div>
          ))
        }
      </Card>
    </div>
  )
}

// ─── ALERTS TAB ───────────────────────────────────────────────────────────────
const ALERT_METRICS   = ['roas', 'spend', 'ctr', 'cpc', 'impressions', 'clicks']
const ALERT_OPERATORS = [
  { id: 'lt',  label: 'drops below'  },
  { id: 'gt',  label: 'rises above'  },
  { id: 'lte', label: '≤ at most'    },
  { id: 'gte', label: '≥ at least'   },
]
const PLATFORM_OPTIONS = [{ id: '', label: 'All Platforms' }, ...PLATFORMS]

function AlertsTab() {
  const [rules,   setRules]   = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [form,    setForm]    = useState({ name: '', platform: '', metric: 'roas', operator: 'lt', threshold: '' })
  const [formErr, setFormErr] = useState('')

  useEffect(() => {
    fetch('/api/ads/alerts')
      .then(r => r.json())
      .then(d => { setRules(d.rules || []); setHistory(d.history || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function createRule() {
    if (!form.name || !form.threshold) { setFormErr('Name and threshold are required'); return }
    setSaving(true); setFormErr('')
    try {
      const r = await fetch('/api/ads/alerts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...form, threshold: parseFloat(form.threshold) }),
      })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setRules(prev => [d.rule, ...prev])
      setForm({ name: '', platform: '', metric: 'roas', operator: 'lt', threshold: '' })
    } catch (e) { setFormErr(e.message) }
    finally { setSaving(false) }
  }

  async function toggleRule(id, enabled) {
    const r = await fetch(`/api/ads/alerts?id=${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    const d = await r.json()
    if (d.rule) setRules(prev => prev.map(x => x.id === id ? d.rule : x))
  }

  async function deleteRule(id) {
    await fetch(`/api/ads/alerts?id=${id}`, { method: 'DELETE' })
    setRules(prev => prev.filter(x => x.id !== id))
  }

  function fmtOp(op) { return ALERT_OPERATORS.find(o => o.id === op)?.label || op }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      {/* Create rule form */}
      <div>
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 14 }}>CREATE ALERT RULE</div>
          <div style={{ marginBottom: 10 }}>
            <label style={LABEL}>RULE NAME *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Low ROAS warning" style={INP} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={LABEL}>PLATFORM</label>
              <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))} style={{ ...INP, cursor: 'pointer' }}>
                {PLATFORM_OPTIONS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL}>METRIC *</label>
              <select value={form.metric} onChange={e => setForm(f => ({ ...f, metric: e.target.value }))} style={{ ...INP, cursor: 'pointer' }}>
                {ALERT_METRICS.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={LABEL}>CONDITION *</label>
              <select value={form.operator} onChange={e => setForm(f => ({ ...f, operator: e.target.value }))} style={{ ...INP, cursor: 'pointer' }}>
                {ALERT_OPERATORS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL}>THRESHOLD *</label>
              <input type="number" step="0.01" value={form.threshold} onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))} placeholder={form.metric === 'roas' ? '2.0' : form.metric === 'ctr' ? '1.5' : '0'} style={INP} />
            </div>
          </div>
          {formErr && <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.red, marginBottom: 10 }}>{formErr}</div>}
          <button onClick={createRule} disabled={saving} style={{ background: saving ? B.gray2 : B.orange, color: B.white, border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'SAVING…' : '+ CREATE RULE'}
          </button>
        </Card>

        {/* Recent alerts fired */}
        <Card>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>RECENT ALERTS FIRED</div>
          {history.length === 0
            ? <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2 }}>No alerts fired yet.</div>
            : history.slice(0, 8).map((h, i) => (
              <div key={h.id || i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, padding: '7px 10px', background: '#FFF8E6', border: '1px solid #C7780030', borderRadius: 6 }}>
                <span style={{ fontSize: 12 }}>⚠</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.text }}>{h.campaign_name || h.platform} — {h.metric.toUpperCase()} {parseFloat(h.value).toFixed(2)}</div>
                  <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted }}>{new Date(h.fired_at).toLocaleString()}</div>
                </div>
                <PlatformBadge platform={h.platform} size="sm" />
              </div>
            ))
          }
        </Card>
      </div>

      {/* Active rules list */}
      <Card>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>ACTIVE RULES ({rules.length})</div>
        {loading && <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted }}>Loading…</div>}
        {!loading && rules.length === 0 && (
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2 }}>No alert rules yet. Create one to get notified when performance drops.</div>
        )}
        {rules.map(rule => (
          <div key={rule.id} style={{ marginBottom: 10, padding: '10px 12px', background: rule.enabled ? B.surface : B.pageBg, border: `1px solid ${rule.enabled ? B.border : B.gray2 + '40'}`, borderRadius: 8, opacity: rule.enabled ? 1 : 0.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: rule.enabled ? B.text : B.muted, letterSpacing: 0.3 }}>{rule.name}</span>
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                <button
                  onClick={() => toggleRule(rule.id, !rule.enabled)}
                  style={{ background: rule.enabled ? B.orangeBg : B.surface, color: rule.enabled ? B.orange : B.muted, border: `1px solid ${rule.enabled ? B.orange + '30' : B.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 8, fontFamily: "'Lexend Zetta',sans-serif", cursor: 'pointer' }}
                >
                  {rule.enabled ? 'ON' : 'OFF'}
                </button>
                <button onClick={() => deleteRule(rule.id)} style={{ background: 'none', color: B.gray2, border: `1px solid ${B.border}`, borderRadius: 4, padding: '2px 7px', fontSize: 9, cursor: 'pointer' }}>✕</button>
              </div>
            </div>
            <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted }}>
              {rule.platform || 'All platforms'} · {rule.metric.toUpperCase()} {fmtOp(rule.operator)} <strong style={{ color: B.text }}>{parseFloat(rule.threshold).toFixed(2)}</strong>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

// ─── CONNECTION CHECKER ───────────────────────────────────────────────────────
function ConnectionPanel({ onClose }) {
  const [status,  setStatus]  = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/ads/status')
      .then(r => r.json())
      .then(d => setStatus(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const allPlatforms = [...PLATFORMS, { id: 'ga4', label: 'Google Analytics 4' }]

  return (
    <Card style={{ marginBottom: 16, border: `1px solid ${B.orange}30`, background: B.orangeBg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.orange, letterSpacing: 2, marginBottom: 10 }}>PLATFORM CONNECTIONS</div>
          {loading
            ? <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted }}>Checking connections…</div>
            : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
                {allPlatforms.map(p => {
                  const s = status[p.id] || {}
                  const connected = s.status === 'connected'
                  const missing   = s.status === 'missing_key'
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? B.green : missing ? B.gray2 : B.red, display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: connected ? B.text : B.muted }}>
                        {s.name || p.label}
                      </span>
                      <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: connected ? B.green : missing ? B.gray2 : B.red }}>
                        {connected ? '✓' : missing ? 'needs key' : s.message ? `— ${s.message.slice(0, 30)}` : 'error'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          }
          <div style={{ marginTop: 12, fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted }}>
            Add API keys in <strong style={{ color: B.orange }}>Tool Manager → Settings</strong> to connect each platform.
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: B.muted, fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1, marginLeft: 12 }}>×</button>
      </div>
    </Card>
  )
}

// ─── AD CREATOR (ported from the legacy Ad Engine) ────────────────────────────
// AdHubModule can run two ways: embedded inside RevOps (s/dispatch/toast are
// passed in and go through RevOps' normal reducer + /api/state sync), or
// standalone at /command-center (those props are undefined, so brandAssets/
// savedAds/socialPosts are read and written directly against the shared
// st1_revops_v2 localStorage blob, same pattern as RFPTool.jsx/Expansion.jsx).
const mkId  = () => Math.random().toString(36).slice(2, 9)
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

function Lbl({ c, s: st = {}, children }) {
  return <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: c || B.muted, letterSpacing: 2.5, textTransform: 'uppercase', ...st }}>{children}</div>
}
function OBtn({ children, onClick, disabled, sm, col, style = {} }) {
  const c = col || B.orange
  return <button onClick={onClick} disabled={disabled} style={{ background: disabled ? B.border : c, color: disabled ? B.muted : B.white, border: 'none', borderRadius: 5, padding: sm ? '5px 11px' : '8px 16px', fontSize: sm ? 10 : 11, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, letterSpacing: .4, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}>{children}</button>
}
function Spin() {
  return <div style={{ width: 18, height: 18, border: `2px solid ${B.border}`, borderTop: `2px solid ${B.orange}`, borderRadius: '50%', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
}

const AD_PV_SIZES = { square: { w: 1080, h: 1080 }, landscape: { w: 1200, h: 628 }, story: { w: 1080, h: 1920 } }
function AdPreview({ tpl, sz, headline, sub, cta, badge, img, bg, tc, ac, logo, logoUrl, maxH = 460 }) {
  const { w, h } = AD_PV_SIZES[sz] || AD_PV_SIZES.square
  const scale = Math.min(maxH / h, 520 / w, 1)
  const props = { headline, sub, cta, badge, img, bg, tc, ac, w, h, logo, logoUrl }
  const inner = tpl === 'clean' ? <_AdClean {...props} /> : tpl === 'split' ? <_AdSplit {...props} /> : tpl === 'overlay' ? <_AdOverlay {...props} /> : <_AdBold {...props} />
  return (
    <div style={{ width: Math.round(w * scale), height: Math.round(h * scale), overflow: 'hidden', borderRadius: 6, flexShrink: 0, position: 'relative' }}>
      <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
        {inner}
      </div>
    </div>
  )
}
function _AdLogo({ ac, logo, logoUrl }) { if (!logo) return null; if (logoUrl) return <img src={logoUrl} style={{ maxHeight: 36, maxWidth: 140, objectFit: 'contain' }} alt="Logo" />; return <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 5, height: 26, background: ac, borderRadius: 2 }} /><div style={{ fontSize: 17, fontWeight: 900, color: ac, letterSpacing: 3, fontFamily: 'system-ui' }}>ST1 SPORTS</div></div> }
function _AdBold({ headline, sub, cta, badge, img, bg, tc, ac, w, h, logo, logoUrl }) { const p = Math.round(h * .055); return (<div style={{ display: 'flex', flexDirection: 'column', background: bg, width: '100%', height: '100%', padding: p, fontFamily: 'system-ui', boxSizing: 'border-box' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: Math.round(h * .042) }}><_AdLogo ac={ac} logo={logo} logoUrl={logoUrl} />{badge && <div style={{ background: ac, color: '#fff', padding: '7px 18px', borderRadius: 4, fontSize: 16, fontWeight: 800, letterSpacing: 1 }}>{badge.toUpperCase()}</div>}</div><div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: Math.round(w * .05) }}><div style={{ display: 'flex', flexDirection: 'column', flex: img ? 1.1 : 1, gap: 20 }}><div style={{ fontSize: Math.round(h * .076), fontWeight: 900, color: tc, lineHeight: 1.05, letterSpacing: -1 }}>{headline}</div>{sub && <div style={{ fontSize: Math.round(h * .028), color: tc + 'BB', lineHeight: 1.5 }}>{sub}</div>}{cta && <div style={{ display: 'inline-block', background: ac, color: '#fff', padding: `${Math.round(h * .021)}px ${Math.round(h * .042)}px`, borderRadius: 7, fontSize: Math.round(h * .028), fontWeight: 800, marginTop: 10 }}>{cta}</div>}</div>{img && <div style={{ flex: .9, display: 'flex', justifyContent: 'center', alignItems: 'center' }}><img src={img} style={{ width: Math.round(w * .38), height: Math.round(h * .57), objectFit: 'contain', borderRadius: 16 }} /></div>}</div></div>) }
function _AdClean({ headline, sub, cta, badge, img, bg, tc, ac, w, h, logo, logoUrl }) { const p = Math.round(h * .06); return (<div style={{ display: 'flex', flexDirection: 'column', background: bg, width: '100%', height: '100%', padding: p, fontFamily: 'system-ui', boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center' }}>{logo && (logoUrl ? <img src={logoUrl} style={{ maxHeight: 40, maxWidth: 160, objectFit: 'contain', marginBottom: Math.round(h * .035) }} alt="Logo" /> : <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: Math.round(h * .035) }}><div style={{ width: 5, height: 24, background: ac, borderRadius: 2 }} /><div style={{ fontSize: 16, fontWeight: 900, color: ac, letterSpacing: 3 }}>ST1 SPORTS</div></div>)}{img && <img src={img} style={{ width: Math.round(w * .52), height: Math.round(h * .44), objectFit: 'contain', borderRadius: 14, marginBottom: Math.round(h * .038) }} />}{badge && <div style={{ background: ac, color: '#fff', padding: '6px 16px', borderRadius: 4, fontSize: 14, fontWeight: 800, marginBottom: 16 }}>{badge.toUpperCase()}</div>}<div style={{ fontSize: Math.round(h * .066), fontWeight: 900, color: tc, lineHeight: 1.08, letterSpacing: -.5, textAlign: 'center', marginBottom: 16 }}>{headline}</div>{sub && <div style={{ fontSize: Math.round(h * .025), color: tc + '99', lineHeight: 1.55, textAlign: 'center', maxWidth: Math.round(w * .76), marginBottom: 22 }}>{sub}</div>}{cta && <div style={{ background: ac, color: '#fff', padding: `${Math.round(h * .021)}px ${Math.round(h * .052)}px`, borderRadius: 7, fontSize: Math.round(h * .026), fontWeight: 800 }}>{cta}</div>}<div style={{ fontSize: 12, color: tc + '44', letterSpacing: 3, marginTop: Math.round(h * .045) }}>ST1SPORTS.COM</div></div>) }
function _AdSplit({ headline, sub, cta, badge, img, bg, tc, ac, w, h, logo, logoUrl }) { const p = Math.round(h * .06); return (<div style={{ display: 'flex', background: bg, width: '100%', height: '100%', fontFamily: 'system-ui' }}><div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: p, justifyContent: 'center', gap: 18 }}>{logo && (logoUrl ? <img src={logoUrl} style={{ maxHeight: 34, maxWidth: 130, objectFit: 'contain', marginBottom: 6 }} alt="Logo" /> : <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><div style={{ width: 5, height: 22, background: ac, borderRadius: 2 }} /><div style={{ fontSize: 15, fontWeight: 900, color: ac, letterSpacing: 3 }}>ST1 SPORTS</div></div>)}{badge && <div style={{ display: 'inline-block', background: ac, color: '#fff', padding: '6px 14px', borderRadius: 4, fontSize: 13, fontWeight: 800 }}>{badge.toUpperCase()}</div>}<div style={{ fontSize: Math.round(h * .074), fontWeight: 900, color: tc, lineHeight: 1.06, letterSpacing: -1 }}>{headline}</div>{sub && <div style={{ fontSize: Math.round(h * .026), color: tc + 'AA', lineHeight: 1.5 }}>{sub}</div>}{cta && <div style={{ display: 'inline-block', background: ac, color: '#fff', padding: `${Math.round(h * .021)}px ${Math.round(h * .04)}px`, borderRadius: 7, fontSize: Math.round(h * .026), fontWeight: 800, marginTop: 8 }}>{cta}</div>}<div style={{ fontSize: 12, color: tc + '44', letterSpacing: 3, marginTop: 'auto' }}>ST1SPORTS.COM</div></div><div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', background: `${ac}0F`, borderLeft: `4px solid ${ac}` }}>{img ? <img src={img} style={{ width: Math.round(w * .41), height: Math.round(h * .66), objectFit: 'contain', borderRadius: 10 }} /> : <div style={{ fontSize: 18, color: tc + '33', fontWeight: 700, letterSpacing: 2 }}>PRODUCT IMAGE</div>}</div></div>) }
function _AdOverlay({ headline, sub, cta, badge, img, bg, tc, ac, w, h, logo, logoUrl }) { const px = Math.round(w * .05), py = Math.round(h * .045); return (<div style={{ position: 'relative', background: bg, width: '100%', height: '100%', fontFamily: 'system-ui', overflow: 'hidden' }}>{img && <img src={img} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}<div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '58%', background: 'linear-gradient(to top,rgba(0,0,0,.93) 0%,rgba(0,0,0,0) 100%)' }} />{logo && (logoUrl ? <img src={logoUrl} style={{ position: 'absolute', top: py, left: px, maxHeight: 32, maxWidth: 120, objectFit: 'contain' }} alt="Logo" /> : <div style={{ position: 'absolute', top: py, left: px, display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 5, height: 22, background: ac, borderRadius: 2 }} /><div style={{ fontSize: 15, fontWeight: 900, color: '#fff', letterSpacing: 3 }}>ST1 SPORTS</div></div>)}{badge && <div style={{ position: 'absolute', top: py, right: px, background: ac, color: '#fff', padding: '7px 17px', borderRadius: 4, fontSize: 14, fontWeight: 800 }}>{badge.toUpperCase()}</div>}<div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: `${Math.round(h * .05)}px ${px}px`, display: 'flex', flexDirection: 'column', gap: 12 }}><div style={{ fontSize: Math.round(h * .072), fontWeight: 900, color: '#fff', lineHeight: 1.05, letterSpacing: -1 }}>{headline}</div>{sub && <div style={{ fontSize: Math.round(h * .024), color: '#FFFFFFCC', lineHeight: 1.45 }}>{sub}</div>}<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>{cta ? <div style={{ display: 'inline-block', background: ac, color: '#fff', padding: `${Math.round(h * .019)}px ${Math.round(h * .037)}px`, borderRadius: 7, fontSize: Math.round(h * .025), fontWeight: 800 }}>{cta}</div> : <div />}<div style={{ fontSize: 12, color: '#FFFFFF66', letterSpacing: 3 }}>ST1SPORTS.COM</div></div></div></div>) }

function CaptionEditor({ caption, onCaption, onGenerate, generating, generatedCopies, toast }) {
  const NETS = [{ id: 'twitter', label: '𝕏', color: '#000' }, { id: 'linkedin', label: 'in', color: '#0A66C2' }, { id: 'instagram', label: 'IG', color: '#E1306C' }, { id: 'facebook', label: 'f', color: '#1877F2' }]
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <Lbl>CAPTION</Lbl>
        <button onClick={onGenerate} disabled={generating} style={{ background: generating ? B.surface : B.orange, color: generating ? B.muted : B.white, border: 'none', borderRadius: 4, padding: '4px 12px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, fontWeight: 700, cursor: generating ? 'default' : 'pointer', letterSpacing: .5 }}>
          {generating ? 'GENERATING…' : '✦ AI COPY'}
        </button>
      </div>
      <textarea value={caption} onChange={e => onCaption(e.target.value)} rows={3}
        style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '7px 9px', fontSize: 12, fontFamily: "'Lexend',sans-serif", resize: 'vertical', boxSizing: 'border-box' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted }}>{caption.length} chars</div>
        <button onClick={() => { navigator.clipboard.writeText(caption); toast('Copied!', 'success') }} style={{ background: 'none', border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '3px 10px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, cursor: 'pointer' }}>⎘ COPY</button>
      </div>
      {generatedCopies && (
        <div style={{ marginTop: 10, background: B.surface, borderRadius: 6, padding: 10, border: `1px solid ${B.border}` }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted, letterSpacing: 1, marginBottom: 8 }}>AI GENERATED — click to use</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {NETS.map(({ id, label, color }) => generatedCopies[id] && (
              <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 9px', background: B.white, borderRadius: 5, border: `1px solid ${B.border}`, cursor: 'pointer' }}
                onClick={() => { onCaption(generatedCopies[id]); toast(`${label} copy loaded`, 'success') }}>
                <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color, minWidth: 18, fontWeight: 700 }}>{label}</span>
                <div style={{ flex: 1, fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.text, lineHeight: 1.4 }}>{generatedCopies[id].slice(0, 180)}{generatedCopies[id].length > 180 ? '…' : ''}</div>
                <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(generatedCopies[id]); toast('Copied!', 'success') }} style={{ background: 'none', border: 'none', color: B.muted, fontSize: 10, cursor: 'pointer', flexShrink: 0, padding: 0 }}>⎘</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SavedAdsPanel({ savedAds, onLoad, onDelete }) {
  if (!savedAds.length) return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 24, textAlign: 'center', color: B.muted, fontFamily: "'Lexend',sans-serif", fontSize: 11 }}>
      No saved ads yet — design an ad in the Build tab and click <strong>✦ SAVE AD</strong> to save it here.
    </div>
  )
  const SZ_LABELS = { square: '1080×1080', landscape: '1200×628', story: '1080×1920' }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
      {savedAds.map(ad => (
        <div key={ad.id} style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ height: 120, background: ad.bg || '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, position: 'relative' }}>
            <div style={{ fontFamily: 'system-ui', fontWeight: 900, color: ad.tc || '#fff', fontSize: 18, lineHeight: 1.1, textAlign: 'center', maxWidth: '90%', overflow: 'hidden' }}>{(ad.headline || '').slice(0, 40)}</div>
            {ad.badge && <div style={{ position: 'absolute', top: 8, right: 8, background: ad.ac || '#F37321', color: '#fff', fontSize: 9, fontWeight: 800, padding: '3px 7px', borderRadius: 3 }}>{ad.badge}</div>}
          </div>
          <div style={{ padding: '10px 12px' }}>
            <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.text, fontWeight: 500, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad.name}</div>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: .5, marginBottom: 8 }}>{(ad.tpl || 'bold').toUpperCase()} · {SZ_LABELS[ad.sz] || ad.sz} · {ad.createdAt}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => onLoad(ad)} style={{ flex: 1, background: B.orange, color: B.white, border: 'none', borderRadius: 4, padding: '6px 0', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, fontWeight: 700, cursor: 'pointer', letterSpacing: .5 }}>LOAD</button>
              <button onClick={() => { if (window.confirm('Delete this saved ad?')) onDelete(ad.id) }} style={{ background: B.redBg, color: B.red, border: `1px solid ${B.red}40`, borderRadius: 4, padding: '6px 10px', fontSize: 10, cursor: 'pointer' }}>✕</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function SocialCalendar({ posts, onAdd, onUpdate, onDelete, toast }) {
  const today2 = new Date()
  const [viewYear, setViewYear] = useState(today2.getFullYear())
  const [viewMonth, setViewMonth] = useState(today2.getMonth())
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ date: '', time: '09:00', platforms: [], caption: '', imageUrl: '', status: 'draft' })
  const NET_COLORS = { twitter: '#000', linkedin: '#0A66C2', instagram: '#E1306C', facebook: '#1877F2' }
  const NET_LABELS = { twitter: '𝕏', linkedin: 'in', instagram: 'IG', facebook: 'f' }
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const todayStr = today2.toISOString().slice(0, 10)
  const openNew = (dateStr) => { setEditing(null); setForm({ date: dateStr || '', time: '09:00', platforms: [], caption: '', imageUrl: '', status: 'draft' }); setShowForm(true) }
  const openEdit = (post) => { setEditing(post.id); setForm({ date: post.date || '', time: post.time || '09:00', platforms: post.platforms || [], caption: post.caption || '', imageUrl: post.imageUrl || '', status: post.status || 'draft' }); setShowForm(true) }
  const save = () => { if (!form.date || !form.caption.trim()) { toast('Date and caption required', 'error'); return } if (editing) onUpdate({ id: editing, ...form }); else onAdd(form); setShowForm(false) }
  const toggleNet = (n) => setForm(f => ({ ...f, platforms: f.platforms.includes(n) ? f.platforms.filter(x => x !== n) : [...f.platforms, n] }))
  const monthName = new Date(viewYear, viewMonth).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { let m = viewMonth - 1, y = viewYear; if (m < 0) { m = 11; y-- } setViewMonth(m); setViewYear(y) }} style={{ background: 'none', border: `1px solid ${B.border}`, borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>‹</button>
          <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 15, color: B.black, minWidth: 160, textAlign: 'center' }}>{monthName.toUpperCase()}</div>
          <button onClick={() => { let m = viewMonth + 1, y = viewYear; if (m > 11) { m = 0; y++ } setViewMonth(m); setViewYear(y) }} style={{ background: 'none', border: `1px solid ${B.border}`, borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>›</button>
        </div>
        <OBtn sm onClick={() => openNew(todayStr)}>+ NEW POST</OBtn>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: B.border, borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
        {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(d => (
          <div key={d} style={{ background: B.surface, padding: '6px 0', textAlign: 'center', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1 }}>{d}</div>
        ))}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`e${i}`} style={{ background: B.surface, minHeight: 80 }} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const d = i + 1
          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const dayPosts = posts.filter(p => p.date === dateStr)
          const isToday = dateStr === todayStr
          return (
            <div key={d} onClick={() => openNew(dateStr)} style={{ background: B.white, minHeight: 80, padding: 6, cursor: 'pointer', position: 'relative' }}
              onMouseEnter={e => e.currentTarget.style.background = B.surface} onMouseLeave={e => e.currentTarget.style.background = B.white}>
              <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: isToday ? B.orange : B.text, fontWeight: isToday ? 700 : 400, marginBottom: 4, display: 'inline-block', ...(isToday ? { background: B.orange, color: B.white, borderRadius: '50%', width: 20, height: 20, lineHeight: '20px', textAlign: 'center', fontSize: 10 } : {}) }}>{d}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dayPosts.map(p => (
                  <div key={p.id} onClick={e => { e.stopPropagation(); openEdit(p) }}
                    style={{ background: p.status === 'published' ? B.greenBg : p.status === 'scheduled' ? B.blueBg : B.orangeBg, borderRadius: 3, padding: '2px 5px', fontSize: 9, fontFamily: "'Lexend',sans-serif", color: p.status === 'published' ? B.green : p.status === 'scheduled' ? B.blue : B.orange, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(p.platforms || []).map(n => <span key={n} style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: NET_COLORS[n], marginRight: 2 }}>{NET_LABELS[n]}</span>)}
                    {p.caption.slice(0, 25)}{p.caption.length > 25 ? '…' : ''}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowForm(false)}>
          <div style={{ background: B.white, borderRadius: 10, padding: 22, width: 480, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 14, color: B.black }}>{editing ? 'EDIT POST' : 'NEW POST'}</div>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: B.muted }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div><Lbl s={{ marginBottom: 3 }}>DATE</Lbl><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '6px 8px', fontSize: 12 }} /></div>
              <div><Lbl s={{ marginBottom: 3 }}>TIME</Lbl><input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '6px 8px', fontSize: 12 }} /></div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Lbl s={{ marginBottom: 6 }}>PLATFORMS</Lbl>
              <div style={{ display: 'flex', gap: 7 }}>
                {Object.entries(NET_LABELS).map(([id, label]) => {
                  const sel = form.platforms.includes(id)
                  const c = NET_COLORS[id]
                  return <button key={id} onClick={() => toggleNet(id)} style={{ background: sel ? `${c}14` : B.surface, color: sel ? c : B.muted, border: `1px solid ${sel ? c : B.border}`, borderRadius: 5, padding: '6px 14px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
                })}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Lbl s={{ marginBottom: 3 }}>CAPTION</Lbl>
              <textarea value={form.caption} onChange={e => setForm(f => ({ ...f, caption: e.target.value }))} rows={4} style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '7px 9px', fontSize: 12, fontFamily: "'Lexend',sans-serif", resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <Lbl s={{ marginBottom: 3 }}>STATUS</Lbl>
              <div style={{ display: 'flex', gap: 7 }}>
                {[['draft', 'Draft', B.orange], ['scheduled', 'Scheduled', B.blue], ['published', 'Published', B.green]].map(([v, l, c]) => (
                  <button key={v} onClick={() => setForm(f => ({ ...f, status: v }))} style={{ flex: 1, background: form.status === v ? `${c}14` : B.surface, color: form.status === v ? c : B.muted, border: `1px solid ${form.status === v ? c : B.border}`, borderRadius: 4, padding: '6px 0', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, fontWeight: 700, cursor: 'pointer' }}>{l.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <OBtn onClick={save} style={{ flex: 1 }}>{editing ? 'SAVE CHANGES' : 'CREATE POST'}</OBtn>
              {editing && <button onClick={() => { if (window.confirm('Delete this post?')) onDelete(editing); setShowForm(false) }} style={{ background: B.redBg, color: B.red, border: `1px solid ${B.red}40`, borderRadius: 5, padding: '8px 14px', fontSize: 11, cursor: 'pointer' }}>Delete</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AssetGallery({ toast }) {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch('/api/adengine/assets?limit=100')
      .then(r => r.json())
      .then(d => setAssets(d.assets || []))
      .catch(() => toast('Failed to load assets', 'error'))
      .finally(() => setLoading(false))
  }, [])
  const del = async (id) => {
    if (!confirm('Delete this asset?')) return
    await fetch(`/api/adengine/assets?id=${id}`, { method: 'DELETE' })
    setAssets(a => a.filter(x => x.id !== id))
    toast('Asset deleted', 'success')
  }
  if (loading) return <div style={{ display: 'flex', gap: 7, alignItems: 'center', color: B.muted, fontSize: 12, padding: 20 }}><Spin />Loading assets…</div>
  if (!assets.length) return <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 20, textAlign: 'center', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted }}>No generated assets yet. Use the AI image generator in the Build tab.</div>
  return (
    <div>
      <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.muted, marginBottom: 12 }}>{assets.length} assets</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
        {assets.map(a => {
          const url = a.displayUrl
          return (
            <div key={a.id} style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 10 }}>
              {url
                ? <img src={url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 4, marginBottom: 8 }} />
                : <div style={{ width: '100%', aspectRatio: '1', background: B.surface, borderRadius: 4, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted }}>Stored on S3</div>
              }
              <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.text, marginBottom: 3 }}>{a.product?.name || '—'}</div>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: .5, marginBottom: 6 }}>{a.width}×{a.height} · {a.platform} · {a.variant}</div>
              <div style={{ display: 'flex', gap: 5 }}>
                {url && <a href={url} download={`asset-${a.id}.png`} style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.blue, textDecoration: 'none' }}>⬇</a>}
                <button onClick={() => del(a.id)} style={{ background: 'none', border: 'none', color: B.red, fontSize: 10, cursor: 'pointer', fontFamily: "'Lexend',sans-serif" }}>✕ Delete</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const CREATOR_SUBTABS = [['build', 'Build'], ['saved', 'Saved Ads'], ['calendar', 'Social Calendar'], ['assets', 'Assets']]
const EMPTY_CREATOR_LOCAL = { brandAssets: [], savedAds: [], socialPosts: [] }

function AdCreatorTab({ s, dispatch, toast: toastProp }) {
  const embedded = !!dispatch
  const toast = toastProp || (() => {})
  const [subTab, setSubTab] = useState('build')

  // ── shared data: real dispatch when embedded in RevOps, direct localStorage otherwise ──
  const [local, setLocal] = useState(() => {
    if (embedded) return EMPTY_CREATOR_LOCAL
    const store = readAppState()
    return {
      brandAssets: Array.isArray(store.brandAssets) ? store.brandAssets : [],
      savedAds: Array.isArray(store.savedAds) ? store.savedAds : [],
      socialPosts: Array.isArray(store.socialPosts) ? store.socialPosts : [],
    }
  })
  const brandAssets = embedded ? (s?.brandAssets || []) : local.brandAssets
  const savedAds    = embedded ? (s?.savedAds || [])    : local.savedAds
  const socialPosts = embedded ? (s?.socialPosts || []) : local.socialPosts
  // one mutator for every field: dispatch when embedded, else write the
  // already-computed next value to local state + the shared localStorage blob
  const mutate = (field, dispatchType, dispatchArg, nextValue) => {
    if (embedded) dispatch(dispatchType, dispatchArg)
    else { setLocal(l => ({ ...l, [field]: nextValue })); setAppStateField(field, nextValue) }
  }
  const addBrandAsset = (asset) => mutate('brandAssets', 'ADD_BRAND_ASSET', asset, [...brandAssets, asset])
  const deleteBrandAsset = (id) => mutate('brandAssets', 'DELETE_BRAND_ASSET', id, brandAssets.filter(a => a.id !== id))
  const addSavedAd = (ad) => mutate('savedAds', 'ADD_SAVED_AD', ad, [ad, ...savedAds])
  const deleteSavedAd = (id) => mutate('savedAds', 'DELETE_SAVED_AD', id, savedAds.filter(a => a.id !== id))
  const addSocialPost = (post) => mutate('socialPosts', 'ADD_SOCIAL_POST', post, [...socialPosts, post])
  const updateSocialPost = (post) => mutate('socialPosts', 'UPDATE_SOCIAL_POST', post, socialPosts.map(p => p.id === post.id ? { ...p, ...post } : p))
  const deleteSocialPost = (id) => mutate('socialPosts', 'DELETE_SOCIAL_POST', id, socialPosts.filter(p => p.id !== id))

  // ── ad creator state ──
  const [adTpl, setAdTpl] = useState('bold')
  const [adSz, setAdSz] = useState('square')
  const [adHeadline, setAdHeadline] = useState('TRAIN HARDER. WIN MORE.')
  const [adSub, setAdSub] = useState('')
  const [adCta, setAdCta] = useState('SHOP NOW')
  const [adBadge, setAdBadge] = useState('')
  const [adBg, setAdBg] = useState('#0A0A0A')
  const [adTc, setAdTc] = useState('#FFFFFF')
  const [adAc, setAdAc] = useState('#F37321')
  const [adLogo, setAdLogo] = useState(true)
  const [adLogoUrl, setAdLogoUrl] = useState('')
  const [adImg, setAdImg] = useState('')
  const [adUrl, setAdUrl] = useState('')
  const [previewUrl, setPreviewUrl] = useState('/api/adengine/render-ad?tpl=bold&sz=square&headline=TRAIN+HARDER.+WIN+MORE.&cta=SHOP+NOW&bg=%230A0A0A&tc=%23FFFFFF&ac=%23F37321')
  const previewTimerRef = useRef(null)
  const brandAssetRef = useRef()
  const [ideoPrompt, setIdeoPrompt] = useState('')
  const [ideoStyle, setIdeoStyle] = useState('REALISTIC')
  const [ideoRunning, setIdeoRunning] = useState(false)
  const [ideoResult, setIdeoResult] = useState(null)
  const [downloadRunning, setDownloadRunning] = useState(false)
  const [showSocialPanel, setShowSocialPanel] = useState(false)
  const [socialCaption, setSocialCaption] = useState('')
  const [socialPlatforms, setSocialPlatforms] = useState(['twitter', 'linkedin', 'instagram', 'facebook'])
  const [socialPostType, setSocialPostType] = useState('post')
  const [socialScheduleAt, setSocialScheduleAt] = useState('')
  const [socialPosting, setSocialPosting] = useState(false)
  const [socialResult, setSocialResult] = useState(null)
  const [copyGenRunning, setCopyGenRunning] = useState(false)
  const [generatedCopies, setGeneratedCopies] = useState(null)

  useEffect(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
    previewTimerRef.current = setTimeout(() => {
      const p = new URLSearchParams()
      p.set('tpl', adTpl); p.set('sz', adSz); p.set('headline', adHeadline || 'YOUR HEADLINE')
      if (adSub) p.set('sub', adSub); if (adCta) p.set('cta', adCta); if (adBadge) p.set('badge', adBadge)
      p.set('bg', adBg); p.set('tc', adTc); p.set('ac', adAc); p.set('logo', adLogo ? 'true' : 'false')
      if (adImg) p.set('img', adImg)
      setPreviewUrl(`/api/adengine/render-ad?${p.toString()}`)
    }, 600)
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current) }
  }, [adTpl, adSz, adHeadline, adSub, adCta, adBadge, adBg, adTc, adAc, adLogo, adImg])

  const generateIdeogramImage = async () => {
    if (!ideoPrompt.trim()) { toast('Enter a product description first', 'error'); return }
    setIdeoRunning(true); setIdeoResult(null)
    try {
      const r = await fetch('/api/adengine/generate-product-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: ideoPrompt, style: ideoStyle, sizeKey: adSz }) })
      const data = await r.json()
      if (data.imageUrl) { setIdeoResult({ imageUrl: data.imageUrl, assetId: data.asset?.id }); toast('Image generated!', 'success') }
      else { toast(data.error || 'Image gen failed', 'error') }
    } catch { toast('Image gen failed', 'error') }
    setIdeoRunning(false)
  }
  const downloadAd = async () => {
    if (!previewUrl) return
    setDownloadRunning(true)
    try {
      const res = await fetch(previewUrl)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `st1-ad-${adTpl}-${adSz}-${Date.now()}.png`; a.click()
      URL.revokeObjectURL(url)
    } catch { toast('Download failed', 'error') }
    setDownloadRunning(false)
  }
  const generatePlatformCopy = async () => {
    setCopyGenRunning(true); setGeneratedCopies(null)
    try {
      const context = [adHeadline && `Headline: ${adHeadline}`, adSub && `Subheadline: ${adSub}`, adCta && `CTA: ${adCta}`, adBadge && `Badge: ${adBadge}`].filter(Boolean).join('\n')
      const r = await fetch('/api/claude', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 600,
          messages: [{ role: 'user', content: `Generate social media captions for this ad from ST1 Sports (athletic equipment company):\n\n${context}\n\nRespond ONLY with valid JSON:\n{"twitter":"<280 chars, punchy, 1-2 hashtags>","linkedin":"<professional, 2-3 sentences, no hashtags>","instagram":"<engaging, 3-4 sentences, 6-8 hashtags>","facebook":"<conversational, 2-3 sentences, 1-2 hashtags>"}` }],
        }),
      })
      const d = await r.json()
      const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
      const match = text.match(/\{[\s\S]*\}/)
      if (match) setGeneratedCopies(JSON.parse(match[0]))
    } catch { toast('Copy generation failed', 'error') }
    setCopyGenRunning(false)
  }
  const openSocialPanel = () => {
    setShowSocialPanel(true); setSocialResult(null)
    const parts = [adHeadline, adSub, adCta ? `👉 ${adCta}` : '', '#ST1Sports #Athletics #TrackAndField'].filter(Boolean)
    setSocialCaption(parts.join('\n\n'))
  }
  const submitSocialPost = async () => {
    if (!socialPlatforms.length) { toast('Select at least one platform', 'error'); return }
    if (!socialCaption.trim()) { toast('Caption is required', 'error'); return }
    setSocialPosting(true); setSocialResult(null)
    try {
      const r = await fetch('/api/social-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post: socialCaption, platforms: socialPlatforms, mediaUrls: adImg ? [adImg] : undefined, scheduleDate: socialScheduleAt || undefined, isStory: socialPostType === 'story', link: adUrl || undefined }),
      })
      const data = await r.json()
      const platformErrors = Array.isArray(data.errors) ? data.errors : []
      const isSuccess = (data.status === 'success' || data.status === 'scheduled') && !data.error
      if (isSuccess) {
        const failedNets = platformErrors.map(e => e.network || e.platform).filter(Boolean)
        const okCount = socialPlatforms.length - failedNets.length
        setSocialResult({ ok: true, platformErrors, failedNets, warning: data._warning })
        if (failedNets.length === 0) toast(socialScheduleAt ? `Scheduled for ${new Date(socialScheduleAt).toLocaleString()}!` : `Posted to ${okCount} platform(s)!`, 'success')
        else toast(`Posted to ${okCount} platform(s). Failed: ${failedNets.join(', ')}`, 'warn')
        addSocialPost({
          id: mkId(), createdAt: today(),
          date: socialScheduleAt ? socialScheduleAt.slice(0, 10) : today(),
          time: socialScheduleAt ? socialScheduleAt.slice(11, 16) : new Date().toTimeString().slice(0, 5),
          platforms: socialPlatforms, caption: socialCaption, imageUrl: adImg, link: adUrl,
          status: socialScheduleAt ? 'scheduled' : 'published', postType: socialPostType,
        })
      } else {
        const errMsg = data.error || data.message || (platformErrors[0]?.message) || 'Post failed'
        setSocialResult({ ok: false, error: errMsg }); toast(errMsg, 'error')
      }
    } catch { toast('Post failed', 'error') }
    setSocialPosting(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 18, flexWrap: 'wrap' }}>
        {CREATOR_SUBTABS.map(([id, l]) => (
          <button key={id} onClick={() => setSubTab(id)} style={{ background: subTab === id ? B.orange : B.white, color: subTab === id ? B.white : B.muted, border: `1px solid ${subTab === id ? B.orange : B.border}`, borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, letterSpacing: .4, cursor: 'pointer' }}>{l}</button>
        ))}
      </div>

      {subTab === 'saved' && <SavedAdsPanel savedAds={savedAds} onLoad={ad => { setAdTpl(ad.tpl || 'bold'); setAdSz(ad.sz || 'square'); setAdHeadline(ad.headline || ''); setAdSub(ad.sub || ''); setAdCta(ad.cta || ''); setAdBadge(ad.badge || ''); setAdBg(ad.bg || '#0A0A0A'); setAdTc(ad.tc || '#FFFFFF'); setAdAc(ad.ac || '#F37321'); setAdLogo(ad.logo !== false); setAdLogoUrl(ad.logoUrl || ''); setAdImg(ad.img || ''); setAdUrl(ad.url || ''); setSubTab('build'); toast(`Loaded "${ad.name}"`, 'success') }} onDelete={deleteSavedAd} />}
      {subTab === 'calendar' && <SocialCalendar posts={socialPosts} onAdd={post => addSocialPost({ id: mkId(), createdAt: today(), ...post })} onUpdate={updateSocialPost} onDelete={deleteSocialPost} toast={toast} />}
      {subTab === 'assets' && <AssetGallery toast={toast} />}

      {subTab === 'build' && (
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: B.muted, letterSpacing: 1, marginBottom: 10 }}>TEMPLATE</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {[['bold', 'Bold — Dark + Headline'], ['clean', 'Clean — Centered'], ['split', 'Split — Copy | Image'], ['overlay', 'Overlay — Full Bleed']].map(([id, label]) => (
                  <button key={id} onClick={() => setAdTpl(id)} style={{ background: adTpl === id ? B.orange : B.surface, color: adTpl === id ? B.white : B.text, border: `1px solid ${adTpl === id ? B.orange : B.border}`, borderRadius: 5, padding: '8px 10px', fontSize: 10, fontFamily: "'Lexend',sans-serif", fontWeight: adTpl === id ? 700 : 400, cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, letterSpacing: .5, marginBottom: 2 }}>{id.toUpperCase()}</div>
                    <div style={{ fontSize: 9, opacity: .7 }}>{label.split('—')[1].trim()}</div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: B.muted, letterSpacing: 1, marginBottom: 10 }}>SIZE</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[['square', '1:1', '1080×1080'], ['landscape', '16:9', '1200×628'], ['story', '9:16', '1080×1920']].map(([id, ratio, dims]) => (
                  <button key={id} onClick={() => setAdSz(id)} style={{ flex: 1, background: adSz === id ? B.orange : B.surface, color: adSz === id ? B.white : B.text, border: `1px solid ${adSz === id ? B.orange : B.border}`, borderRadius: 5, padding: '8px 6px', fontSize: 9, fontFamily: "'Lexend',sans-serif", cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 10, letterSpacing: .5, marginBottom: 1 }}>{ratio}</div>
                    <div style={{ fontSize: 8, opacity: .65 }}>{dims}</div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: B.muted, letterSpacing: 1, marginBottom: 10 }}>AD TEXT</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div><Lbl s={{ marginBottom: 3 }}>Headline</Lbl><input value={adHeadline} onChange={e => setAdHeadline(e.target.value)} placeholder="TRAIN HARDER. WIN MORE." style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '6px 8px', fontSize: 12, fontFamily: "'Lexend',sans-serif", fontWeight: 600, boxSizing: 'border-box' }} /></div>
                <div><Lbl s={{ marginBottom: 3 }}>Subheadline</Lbl><input value={adSub} onChange={e => setAdSub(e.target.value)} placeholder="Supporting copy (optional)" style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '6px 8px', fontSize: 11, fontFamily: "'Lexend',sans-serif", boxSizing: 'border-box' }} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div><Lbl s={{ marginBottom: 3 }}>CTA Button</Lbl><input value={adCta} onChange={e => setAdCta(e.target.value)} placeholder="SHOP NOW" style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '6px 8px', fontSize: 11, fontFamily: "'Lexend',sans-serif", boxSizing: 'border-box' }} /></div>
                  <div><Lbl s={{ marginBottom: 3 }}>Badge</Lbl><input value={adBadge} onChange={e => setAdBadge(e.target.value)} placeholder="NEW · SALE · FREE SHIP" style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '6px 8px', fontSize: 11, fontFamily: "'Lexend',sans-serif", boxSizing: 'border-box' }} /></div>
                </div>
                <div><Lbl s={{ marginBottom: 3 }}>Link URL (appended to social posts)</Lbl><input value={adUrl} onChange={e => setAdUrl(e.target.value)} placeholder="https://st1sports.com/products/..." style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '6px 8px', fontSize: 11, fontFamily: 'monospace', boxSizing: 'border-box' }} /></div>
              </div>
            </div>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: B.muted, letterSpacing: 1, marginBottom: 10 }}>COLORS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[['Background', adBg, setAdBg], ['Text Color', adTc, setAdTc], ['Accent Color', adAc, setAdAc]].map(([label, val, setter]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.text, width: 90, flexShrink: 0 }}>{label}</div>
                    <input type="color" value={val} onChange={e => setter(e.target.value)} style={{ width: 32, height: 28, border: `1px solid ${B.border}`, borderRadius: 4, cursor: 'pointer', padding: 2, background: B.surface }} />
                    <input value={val} onChange={e => setter(e.target.value)} maxLength={7} style={{ flex: 1, background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '5px 8px', fontSize: 11, fontFamily: 'monospace' }} />
                    <div style={{ width: 22, height: 22, borderRadius: 4, background: val, border: `1px solid ${B.border}`, flexShrink: 0 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <input type="checkbox" id="adlogo" checked={adLogo} onChange={e => setAdLogo(e.target.checked)} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <label htmlFor="adlogo" style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.text, cursor: 'pointer' }}>{adLogoUrl ? 'Show brand logo ✓' : 'Show brand logo (upload below)'}</label>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted, width: '100%', marginBottom: 2 }}>PRESETS</div>
                {[['Dark', ['#0A0A0A', '#FFFFFF', '#F37321']], ['Light', ['#FFFFFF', '#0A0A0A', '#F37321']], ['Navy', ['#0B1A3E', '#FFFFFF', '#F37321']], ['Forest', ['#1A3A2A', '#FFFFFF', '#4CAF50']]].map(([name, [bg, tc, ac]]) => (
                  <button key={name} onClick={() => { setAdBg(bg); setAdTc(tc); setAdAc(ac) }} style={{ background: bg, color: tc, border: `2px solid ${ac}`, borderRadius: 4, padding: '4px 10px', fontSize: 9, fontFamily: "'Lexend',sans-serif", cursor: 'pointer' }}>{name}</button>
                ))}
              </div>
            </div>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: B.muted, letterSpacing: 1 }}>BRAND ASSETS</div>
                <button onClick={() => brandAssetRef.current?.click()} style={{ background: B.orangeBg, color: B.orange, border: `1px solid ${B.orange}40`, borderRadius: 4, padding: '3px 9px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", cursor: 'pointer', letterSpacing: .5 }}>+ UPLOAD</button>
                <input ref={brandAssetRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={async e => {
                  const files = [...e.target.files]
                  for (const f of files) {
                    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f) })
                    const isLogo = /logo/i.test(f.name)
                    addBrandAsset({ id: mkId(), name: f.name, url: dataUrl, type: isLogo ? 'logo' : 'asset', createdAt: new Date().toISOString().slice(0, 10) })
                  }
                  e.target.value = ''
                  toast(`Uploaded ${files.length} asset${files.length > 1 ? 's' : ''}!`, 'success')
                }} />
              </div>
              {brandAssets.length === 0 && (
                <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted, textAlign: 'center', padding: '10px 0' }}>No assets yet — upload logos, product shots, or brand images</div>
              )}
              {brandAssets.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                  {brandAssets.map(a => {
                    const isLogoSel = adLogoUrl === a.url
                    const isImgSel = adImg === a.url
                    return (
                      <div key={a.id} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: `2px solid ${isLogoSel ? B.orange : isImgSel ? B.blue : B.border}`, background: B.surface }}>
                        <img src={a.url} alt={a.name} style={{ width: '100%', height: 56, objectFit: 'contain', display: 'block', background: '#111', padding: 4 }} />
                        <div style={{ padding: '3px 4px' }}>
                          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 8, color: B.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name.replace(/\.[^.]+$/, '')}</div>
                          <div style={{ display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap' }}>
                            <button onClick={() => { setAdLogoUrl(isLogoSel ? '' : a.url); if (!isLogoSel) setAdLogo(true) }} style={{ background: isLogoSel ? B.orange : B.orangeBg, color: isLogoSel ? B.white : B.orange, border: `1px solid ${B.orange}40`, borderRadius: 3, padding: '2px 4px', fontSize: 7, fontFamily: "'Lexend Zetta',sans-serif", cursor: 'pointer' }}>LOGO</button>
                            <button onClick={() => setAdImg(isImgSel ? '' : a.url)} style={{ background: isImgSel ? B.blue : B.blueBg, color: isImgSel ? B.white : B.blue, border: `1px solid ${B.blue}40`, borderRadius: 3, padding: '2px 4px', fontSize: 7, fontFamily: "'Lexend Zetta',sans-serif", cursor: 'pointer' }}>IMG</button>
                            <button onClick={() => { if (adLogoUrl === a.url) setAdLogoUrl(''); if (adImg === a.url) setAdImg(''); deleteBrandAsset(a.id) }} style={{ background: 'none', border: 'none', color: B.muted, fontSize: 8, cursor: 'pointer', padding: '2px 3px', marginLeft: 'auto' }}>✕</button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {brandAssets.length > 0 && (
                <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted, marginTop: 8 }}>
                  Click <span style={{ color: B.orange }}>LOGO</span> to use as brand logo · <span style={{ color: B.blue }}>IMG</span> to use as background/product image
                </div>
              )}
            </div>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: B.muted, letterSpacing: 1, marginBottom: 10 }}>PRODUCT IMAGE (Ideogram AI)</div>
              <textarea value={ideoPrompt} onChange={e => setIdeoPrompt(e.target.value)} rows={3} placeholder="Describe what the image should show… e.g. 'Aluminum track hurdle on an Olympic running track, cinematic lighting, product photo'" style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '7px 9px', fontSize: 11, fontFamily: "'Lexend',sans-serif", resize: 'vertical', marginBottom: 8, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select value={ideoStyle} onChange={e => setIdeoStyle(e.target.value)} style={{ flex: 1, background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '6px 8px', fontSize: 11 }}>
                  {['REALISTIC', 'DESIGN', 'GENERAL', 'ANIME', 'AUTO'].map(st => <option key={st}>{st}</option>)}
                </select>
                <OBtn onClick={generateIdeogramImage} disabled={ideoRunning} style={{ flexShrink: 0 }}>
                  {ideoRunning ? 'GENERATING...' : '✦ GENERATE'}
                </OBtn>
              </div>
              {ideoResult && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <img src={ideoResult.imageUrl} alt="Generated" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, border: `1px solid ${B.border}`, flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <button onClick={() => setAdImg(ideoResult.imageUrl)} style={{ background: adImg === ideoResult.imageUrl ? B.orange : B.orangeBg, color: adImg === ideoResult.imageUrl ? B.white : B.orange, border: `1px solid ${B.orange}`, borderRadius: 4, padding: '5px 10px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", cursor: 'pointer' }}>
                      {adImg === ideoResult.imageUrl ? '✓ IN USE' : 'USE IN AD'}
                    </button>
                    <button onClick={() => { setAdImg(ideoResult.imageUrl); const parts = [adHeadline, adSub, adCta ? `👉 ${adCta}` : '', '#ST1Sports #Athletics #TrackAndField'].filter(Boolean); setSocialCaption(parts.join('\n\n')); setShowSocialPanel(true); setSocialResult(null) }} style={{ background: B.purple, color: B.white, border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", cursor: 'pointer', letterSpacing: .3 }}>
                      📣 POST THIS
                    </button>
                    <button onClick={() => setAdImg('')} style={{ background: 'none', border: 'none', color: B.muted, fontSize: 9, cursor: 'pointer', fontFamily: "'Lexend',sans-serif", textAlign: 'left' }}>Clear image</button>
                  </div>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <Lbl s={{ marginBottom: 3 }}>Or paste any image URL</Lbl>
                <input value={adImg} onChange={e => setAdImg(e.target.value)} placeholder="https://…" style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '6px 8px', fontSize: 10, fontFamily: 'monospace', boxSizing: 'border-box' }} />
              </div>
            </div>
          </div>
          <div style={{ position: 'sticky', top: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 14, color: B.black }}>LIVE PREVIEW</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <a href={previewUrl} target="_blank" rel="noreferrer" style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.blue, textDecoration: 'none' }}>Open full size ↗</a>
                <OBtn onClick={downloadAd} disabled={downloadRunning} style={{ padding: '6px 14px' }}>
                  {downloadRunning ? 'DOWNLOADING...' : '⬇ DOWNLOAD PNG'}
                </OBtn>
                <button onClick={() => {
                  const name = adHeadline || 'Untitled Ad'
                  addSavedAd({ id: mkId(), name, tpl: adTpl, sz: adSz, headline: adHeadline, sub: adSub, cta: adCta, badge: adBadge, bg: adBg, tc: adTc, ac: adAc, logo: adLogo, logoUrl: adLogoUrl, img: adImg, url: adUrl, createdAt: today() })
                  toast(`"${name}" saved!`, 'success')
                }} style={{ background: B.white, color: B.green, border: `1px solid ${B.green}`, borderRadius: 4, padding: '6px 12px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, fontWeight: 700, cursor: 'pointer', letterSpacing: .4 }}>
                  ✦ SAVE AD
                </button>
                <button onClick={openSocialPanel} style={{ background: showSocialPanel ? `${B.purple}14` : B.white, color: B.purple, border: `1px solid ${B.purple}`, borderRadius: 4, padding: '6px 12px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, fontWeight: 700, cursor: 'pointer', letterSpacing: .4 }}>
                  📣 POST TO SOCIAL
                </button>
              </div>
            </div>
            <div style={{ background: '#111', borderRadius: 10, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
              <AdPreview tpl={adTpl} sz={adSz} headline={adHeadline || 'YOUR HEADLINE'} sub={adSub} cta={adCta} badge={adBadge} img={adImg} bg={adBg} tc={adTc} ac={adAc} logo={adLogo} logoUrl={adLogoUrl} maxH={adSz === 'story' ? 560 : adSz === 'landscape' ? 320 : 440} />
            </div>
            <div style={{ marginTop: 8, fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted, textAlign: 'center' }}>
              Preview updates automatically · {adTpl.toUpperCase()} template · {adSz === 'square' ? '1080×1080' : adSz === 'landscape' ? '1200×628' : '1080×1920'}
            </div>
            {showSocialPanel && (
              <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 16, marginTop: 12, borderTop: `3px solid ${B.purple}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 13, color: B.black }}>POST TO SOCIAL</div>
                  <button onClick={() => { setShowSocialPanel(false); setSocialResult(null) }} style={{ background: 'none', border: 'none', color: B.muted, fontSize: 16, cursor: 'pointer' }}>✕</button>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted, letterSpacing: 2, marginBottom: 6 }}>PLATFORMS</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[{ id: 'twitter', label: '𝕏', name: 'Twitter/X', color: '#000' }, { id: 'linkedin', label: 'in', name: 'LinkedIn', color: '#0A66C2' }, { id: 'instagram', label: 'IG', name: 'Instagram', color: '#E1306C' }, { id: 'facebook', label: 'f', name: 'Facebook', color: '#1877F2' }, { id: 'tiktok', label: 'TT', name: 'TikTok', color: '#000' }].map(({ id, label, name, color }) => {
                      const sel = socialPlatforms.includes(id)
                      return (
                        <button key={id} onClick={() => setSocialPlatforms(p => sel ? p.filter(x => x !== id) : [...p, id])}
                          style={{ background: sel ? `${color}14` : B.surface, color: sel ? color : B.muted, border: `1.5px solid ${sel ? color : B.border}`, borderRadius: 5, padding: '5px 12px', fontSize: 11, fontFamily: "'Lexend',sans-serif", cursor: 'pointer', fontWeight: sel ? 700 : 400 }}>
                          <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 10 }}>{label}</span> {name}{sel && <span style={{ marginLeft: 4 }}>✓</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted, letterSpacing: 2, marginBottom: 6 }}>POST TYPE</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[['post', 'Post'], ['story', 'Story'], ['ad', 'Ad (Meta/Google)']].map(([id, label]) => (
                      <button key={id} onClick={() => setSocialPostType(id)}
                        style={{ background: socialPostType === id ? B.purple : B.surface, color: socialPostType === id ? B.white : B.muted, border: `1px solid ${socialPostType === id ? B.purple : B.border}`, borderRadius: 5, padding: '5px 14px', fontSize: 10, fontFamily: "'Lexend',sans-serif", cursor: 'pointer', fontWeight: socialPostType === id ? 700 : 400 }}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {socialPostType === 'ad' && (
                    <div style={{ marginTop: 8, background: '#f0f4ff', border: '1px solid #c5d0f0', borderRadius: 6, padding: '10px 12px', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: '#354080', lineHeight: 1.6 }}>
                      <strong>Ad Manager links:</strong>&nbsp;
                      <a href="https://adsmanager.facebook.com" target="_blank" rel="noreferrer" style={{ color: '#1877F2', fontWeight: 700, marginRight: 10 }}>Meta Ads ↗</a>
                      <a href="https://ads.google.com" target="_blank" rel="noreferrer" style={{ color: '#4285F4', fontWeight: 700 }}>Google Ads ↗</a>
                      <div style={{ marginTop: 4, fontSize: 10, color: '#667' }}>Download your ad image below and upload it directly in Ads Manager. The caption and URL below are ready to copy.</div>
                    </div>
                  )}
                </div>
                <div style={{ marginBottom: 12 }}>
                  <CaptionEditor caption={socialCaption} onCaption={setSocialCaption} onGenerate={generatePlatformCopy} generating={copyGenRunning} generatedCopies={generatedCopies} toast={toast} />
                  <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted, marginTop: 3 }}>
                    {socialCaption.length} chars · {adImg ? '📎 image attached' : 'no image'}{adUrl && ' · 🔗 link included'}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted, letterSpacing: 1, marginBottom: 4 }}>SCHEDULE (leave blank = post now)</div>
                    <input type="datetime-local" value={socialScheduleAt} onChange={e => setSocialScheduleAt(e.target.value)}
                      style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '6px 8px', fontSize: 11 }} />
                  </div>
                  <div>
                    <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted, letterSpacing: 1, marginBottom: 4 }}>LINK URL</div>
                    <input value={adUrl} onChange={e => setAdUrl(e.target.value)} placeholder="https://st1sports.com/…"
                      style={{ width: '100%', background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: '6px 8px', fontSize: 11, fontFamily: 'monospace' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={submitSocialPost} disabled={socialPosting || !socialPlatforms.length || !socialCaption.trim()}
                    style={{ background: socialPosting || !socialPlatforms.length || !socialCaption.trim() ? B.muted : B.purple, color: B.white, border: 'none', borderRadius: 5, padding: '9px 20px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 10, fontWeight: 700, cursor: 'pointer', letterSpacing: .5 }}>
                    {socialPosting ? 'POSTING…' : socialScheduleAt ? '🗓 SCHEDULE POST' : '📣 POST NOW'}
                  </button>
                  {adImg && <a href={adImg} download="st1-ad.png" style={{ background: B.surface, color: B.text, border: `1px solid ${B.border}`, borderRadius: 5, padding: '8px 14px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, fontWeight: 700, textDecoration: 'none', letterSpacing: .5 }}>⬇ DOWNLOAD IMAGE</a>}
                  {socialResult?.ok && socialResult.failedNets?.length === 0 && <span style={{ color: B.green, fontFamily: "'Lexend',sans-serif", fontSize: 11, fontWeight: 600 }}>{socialScheduleAt ? '✓ Scheduled!' : '✓ Posted!'}</span>}
                  {socialResult?.ok && socialResult.failedNets?.length > 0 && <span style={{ color: '#C77800', fontFamily: "'Lexend',sans-serif", fontSize: 10 }}>⚠ Partial — failed: {socialResult.failedNets.join(', ')}</span>}
                  {socialResult?.error && <span style={{ color: B.red, fontFamily: "'Lexend',sans-serif", fontSize: 10 }}>✗ {socialResult.error.slice(0, 100)}</span>}
                </div>
                {socialResult?.warning && (
                  <div style={{ marginTop: 10, background: '#fff3cd', border: '1px solid #f0ad0060', borderRadius: 6, padding: '10px 12px', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: '#7a4f00', lineHeight: 1.6 }}>
                    ⚠ <strong>Image not attached:</strong> {socialResult.warning}
                  </div>
                )}
                {socialResult?.error && (
                  <div style={{ marginTop: 10, background: '#fff3cd', border: '1px solid #f0ad0060', borderRadius: 6, padding: '10px 12px', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: '#7a4f00', lineHeight: 1.6 }}>
                    <strong>Post failed:</strong> {socialResult.error}
                  </div>
                )}
              </div>
            )}
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 12, marginTop: 12 }}>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted, letterSpacing: 1, marginBottom: 8 }}>QUICK COPY PRESETS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  ['Track & Field', 'BUILT FOR CHAMPIONS', 'Competition-grade equipment for serious athletes', 'SHOP NOW', 'NEW'],
                  ['School Sports', 'EQUIP YOUR TEAM', 'ST1 Sports — trusted by coaches nationwide', 'GET A QUOTE', ''],
                  ['Hurdles', 'CLEAR EVERY BAR', 'Professional hurdles. Championship results.', 'SHOP HURDLES', ''],
                  ['Sale', 'LIMITED TIME OFFER', 'Save big on top-rated athletic equipment', 'SAVE NOW', 'SALE'],
                ].map(([name, h, sub, c, b]) => (
                  <button key={name} onClick={() => { setAdHeadline(h); setAdSub(sub); setAdCta(c); setAdBadge(b) }} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 10, fontFamily: "'Lexend',sans-serif", cursor: 'pointer', textAlign: 'left', color: B.text }}>
                    <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.orange, letterSpacing: .5 }}>{name}</span> — {h}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────
export default function AdHubModule({ userRole, s, dispatch, toast }) {
  const [tab,        setTab]       = useState('dashboard')
  const [platforms,  setPlatforms] = useState(PLATFORMS.map(p => p.id))
  const [dateRange,  setDateRange] = useState('last_30_days')
  const [showConn,   setShowConn]  = useState(true)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <div style={{ width: 40, height: 40, background: B.orange, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>📊</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h1 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 20, color: B.black, letterSpacing: .3, margin: 0 }}>Ad Hub</h1>
            <button
              onClick={() => setShowConn(v => !v)}
              style={{ background: B.surface, color: B.muted, border: `1px solid ${B.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'pointer' }}
            >
              {showConn ? 'HIDE' : 'SHOW'} CONNECTIONS
            </button>
          </div>
          <p style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted, margin: '3px 0 0', lineHeight: 1.5 }}>
            Unified ad analytics, campaign management, and creative launch across Meta, Google, YouTube, LinkedIn, TikTok, and Microsoft.
          </p>
        </div>
      </div>

      {showConn && <ConnectionPanel onClose={() => setShowConn(false)} />}

      <TabBar active={tab} onChange={setTab} />

      {(tab === 'dashboard' || tab === 'campaigns') && (
        <ControlsBar
          platforms={platforms}
          onPlatforms={setPlatforms}
          dateRange={dateRange}
          onDateRange={setDateRange}
        />
      )}

      {tab === 'dashboard'   && <DashboardTab   platforms={platforms} dateRange={dateRange} userRole={userRole} />}
      {tab === 'creator'     && <AdCreatorTab   s={s} dispatch={dispatch} toast={toast} />}
      {tab === 'campaigns'   && <CampaignsTab   platforms={platforms} dateRange={dateRange} />}
      {tab === 'create'      && <CreateTab       userRole={userRole} onSwitchToTab={setTab} />}
      {tab === 'attribution' && <AttributionTab />}
      {tab === 'utm'         && <UTMBuilderTab />}
      {tab === 'alerts'      && <AlertsTab />}
    </div>
  )
}
