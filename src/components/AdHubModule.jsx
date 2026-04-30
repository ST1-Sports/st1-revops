import React, { useState } from 'react'

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
function DashboardTab({ platforms, dateRange }) {
  return (
    <div>
      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 16 }}>KPI SUMMARY</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
          {['Spend', 'Revenue', 'ROAS', 'Impressions', 'Clicks', 'CTR'].map(k => (
            <div key={k} style={{ background: B.surface, borderRadius: 8, padding: '14px 12px', border: `1px solid ${B.border}` }}>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, marginBottom: 6 }}>{k}</div>
              <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, color: B.gray2 }}>—</div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Card>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 10 }}>PLATFORM BREAKDOWN</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {platforms.map(pid => {
              const p = PLATFORMS.find(x => x.id === pid)
              return (
                <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PlatformBadge platform={pid} size="sm" />
                  <div style={{ flex: 1, height: 6, background: B.surface, borderRadius: 3, border: `1px solid ${B.border}` }}>
                    <div style={{ width: '0%', height: '100%', background: p?.color, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2, minWidth: 40, textAlign: 'right' }}>—</span>
                </div>
              )
            })}
          </div>
        </Card>
        <Card>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 10 }}>TOP PERFORMERS</div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2 }}>Connect platforms to see top performing campaigns by ROAS.</div>
        </Card>
      </div>

      <Card>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 10 }}>CAMPAIGN PERFORMANCE TABLE</div>
        <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray2 }}>Platform data will populate here once API keys are added in Tool Manager.</div>
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

      {tab === 'dashboard' && <DashboardTab platforms={platforms} dateRange={dateRange} />}
      {tab === 'campaigns' && <CampaignsTab platforms={platforms} />}
      {tab === 'create'    && <CreateTab />}
    </div>
  )
}
