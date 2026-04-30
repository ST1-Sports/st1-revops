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
  { id: 'dashboard', label: 'Dashboard'       },
  { id: 'campaigns', label: 'Campaigns'       },
  { id: 'create',    label: 'Create Campaign' },
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

function CampaignsTab({ platforms }) {
  return (
    <Card>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 16 }}>ALL CAMPAIGNS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {platforms.map(pid => (
          <div key={pid} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <PlatformBadge platform={pid} size="sm" />
            <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2, flex: 1 }}>Connect {PLATFORMS.find(p => p.id === pid)?.label} to load campaigns</span>
            <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.gray2, letterSpacing: 1 }}>NOT CONNECTED</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function CreateTab() {
  return (
    <Card>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.orange, letterSpacing: 2, marginBottom: 8 }}>CREATE CAMPAIGN</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {['1  Name + Objective', '2  Audience', '3  Creative', '4  Budget + Schedule', '5  Select Platforms + Launch'].map((step, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, opacity: i === 0 ? 1 : 0.45 }}>
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: i === 0 ? B.orange : B.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: i === 0 ? B.white : B.muted, flexShrink: 0 }}>{i + 1}</span>
            <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: i === 0 ? B.text : B.muted }}>{step.replace(/^\d+\s+/, '')}</span>
          </div>
        ))}
        <button
          disabled
          style={{ background: B.gray2, color: B.white, border: 'none', borderRadius: 6, padding: '10px 22px', fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'not-allowed', alignSelf: 'flex-start', marginTop: 4 }}
        >
          COMING IN NEXT BUILD
        </button>
      </div>
    </Card>
  )
}

// ─── CONNECTION CHECKER ───────────────────────────────────────────────────────
function ConnectionPanel({ onClose }) {
  return (
    <Card style={{ marginBottom: 16, border: `1px solid ${B.orange}30`, background: B.orangeBg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.orange, letterSpacing: 2, marginBottom: 10 }}>PLATFORM CONNECTIONS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {PLATFORMS.map(p => <ConnectionStatus key={p.id} label={p.label} connected={false} />)}
          </div>
          <div style={{ marginTop: 12, fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted }}>
            Add API keys in <strong style={{ color: B.orange }}>Tool Manager → Settings</strong> to connect each platform.
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: B.muted, fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
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
            Unified ad analytics, campaign management, and creative launch across Meta, Google, LinkedIn, TikTok, and Microsoft.
          </p>
        </div>
      </div>

      {showConn && <ConnectionPanel onClose={() => setShowConn(false)} />}

      <TabBar active={tab} onChange={setTab} />

      {tab !== 'create' && (
        <ControlsBar
          platforms={platforms}
          onPlatforms={setPlatforms}
          dateRange={dateRange}
          onDateRange={setDateRange}
        />
      )}

      {tab === 'dashboard' && <DashboardTab platforms={platforms} dateRange={dateRange} userRole={userRole} />}
      {tab === 'campaigns' && <CampaignsTab platforms={platforms} />}
      {tab === 'create'    && <CreateTab />}
    </div>
  )
}
