import React, { useState, useEffect, useCallback } from 'react'
import { routeTask } from '../lib/aiRouter.js'

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

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────
export default function AdHubModule({ userRole }) {
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
      {tab === 'campaigns'   && <CampaignsTab   platforms={platforms} dateRange={dateRange} />}
      {tab === 'create'      && <CreateTab       userRole={userRole} onSwitchToTab={setTab} />}
      {tab === 'attribution' && <AttributionTab />}
      {tab === 'utm'         && <UTMBuilderTab />}
      {tab === 'alerts'      && <AlertsTab />}
    </div>
  )
}
