import React, { useState } from 'react'
import { routeTask } from '../lib/aiRouter.js'

// ─── BRAND ────────────────────────────────────────────────────────────────────
const B = {
  pageBg:   '#F2F2F0',
  white:    '#FFFFFF',
  surface:  '#F8F7F5',
  orange:   '#F37321',
  orangeL:  '#FF9942',
  orangeBg: '#FEF3EC',
  black:    '#000000',
  gray1:    '#424242',
  gray2:    '#B2B9C1',
  border:   '#E2E0DB',
  text:     '#1A1A18',
  muted:    '#7A7872',
  green:    '#1E8F4E',
  greenBg:  '#EAF7EE',
  red:      '#C0392B',
  redBg:    '#FDECEA',
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getStoredRole() {
  try {
    const raw = localStorage.getItem('st1_revops_v2')
    if (!raw) return 'sales_rep'
    const s = JSON.parse(raw)
    const all = [...(s.reps || []), ...(s.appUsers || [])]
    const user = all.find(r => r.id === s.currentUserId)
    return user?.role || 'sales_rep'
  } catch {
    return 'sales_rep'
  }
}

// ─── MODULE DEFINITIONS ───────────────────────────────────────────────────────
const MODULES = [
  {
    id:   'sales-copy',
    icon: '✍',
    label: 'Sales Copywriter',
    cap:  'copy',
    desc: 'AI-generated sales copy, one-pagers, and outreach scripts tailored to your deals.',
  },
  {
    id:   'social',
    icon: '📱',
    label: 'Social Media',
    cap:  'social',
    desc: 'Draft and schedule social posts across Instagram, LinkedIn, Facebook, and more.',
  },
  {
    id:   'image',
    icon: '🖼',
    label: 'Image Generator',
    cap:  'image',
    desc: 'Generate on-brand images and graphics for campaigns, ads, and social content.',
  },
  {
    id:   'quote',
    icon: '▤',
    label: 'Smart Quote Builder',
    cap:  'quote',
    desc: 'Build professional quotes and proposals with AI-assisted pricing and scope.',
  },
  {
    id:   'price-intel',
    icon: '$',
    label: 'Price List Intel',
    cap:  'competitor-intel',
    desc: 'Analyze competitor pricing and generate comparison reports and battle cards.',
  },
  {
    id:   'research',
    icon: '⊕',
    label: 'Research & Intel',
    cap:  'research',
    desc: 'Deep-dive research on prospects, markets, and opportunities using web intelligence.',
  },
  {
    id:   'finance',
    icon: '↑',
    label: 'Financial Summaries',
    cap:  'finance',
    desc: 'Summarize revenue, AR, and deal data into concise executive-ready reports.',
  },
  {
    id:        'tool-manager',
    icon:      '⚙',
    label:     'Tool Manager',
    cap:       'workflow',
    desc:      'Configure plugins, manage API keys, and control which tools each role can access.',
    adminOnly: true,
  },
]

// ─── PLACEHOLDER PANEL ────────────────────────────────────────────────────────
function PlaceholderPanel({ mod, userRole }) {
  const [task,    setTask]    = useState('')
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  async function handleRoute() {
    const t = task.trim()
    if (!t) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const r = await routeTask({ task: t, input: {}, userRole })
      setResult(r)
    } catch (e) {
      setError(e.message || 'Routing failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 32 }}>

      {/* Module header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 42, height: 42, background: B.orange, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <span style={{ fontSize: 20 }}>{mod.icon}</span>
          </div>
          <div>
            <h1 style={{
              fontFamily: "'Russo One',sans-serif", fontSize: 22, color: B.black,
              letterSpacing: 0.3, margin: 0,
            }}>{mod.label}</h1>
            <p style={{
              fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.muted,
              margin: '3px 0 0', lineHeight: 1.5,
            }}>{mod.desc}</p>
          </div>
        </div>
      </div>

      {/* AI Router demo */}
      <div style={{
        background: B.white, border: `1px solid ${B.border}`, borderRadius: 10,
        padding: 20, marginBottom: 24,
        boxShadow: '0 1px 4px rgba(0,0,0,.05)',
      }}>
        <div style={{
          fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.orange,
          letterSpacing: 2, marginBottom: 12,
        }}>AI ROUTER DEMO</div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={task}
            onChange={e => setTask(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRoute()}
            placeholder={`Describe a task to route through the AI (e.g. "write a follow-up email for ${mod.label.toLowerCase()}")`}
            style={{
              flex: 1, background: B.surface, border: `1px solid ${B.border}`,
              borderRadius: 6, padding: '9px 12px', fontSize: 12,
              fontFamily: "'Lexend',sans-serif", color: B.text, outline: 'none',
            }}
          />
          <button
            onClick={handleRoute}
            disabled={loading || !task.trim()}
            style={{
              background: loading || !task.trim() ? B.gray2 : B.orange,
              color: B.white, border: 'none', borderRadius: 6,
              padding: '9px 18px', fontSize: 11, fontWeight: 600,
              fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5,
              cursor: loading || !task.trim() ? 'default' : 'pointer',
              flexShrink: 0, transition: 'background .15s',
            }}
          >
            {loading ? 'ROUTING…' : 'ROUTE →'}
          </button>
        </div>

        {error && (
          <div style={{
            marginTop: 12, padding: '8px 12px', background: B.redBg,
            border: `1px solid ${B.red}30`, borderRadius: 6,
            fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.red,
          }}>{error}</div>
        )}

        {result && (
          <div style={{
            marginTop: 12, padding: 14, background: B.surface,
            border: `1px solid ${B.border}`, borderRadius: 8,
          }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: result.output ? 10 : 0, flexWrap: 'wrap' }}>
              <Chip label="CAPABILITY" value={result.capability} />
              <Chip label="PLUGIN"     value={result.pluginUsed} />
            </div>
            {result.output && (
              <div style={{
                fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text,
                lineHeight: 1.6, whiteSpace: 'pre-wrap',
                borderTop: `1px solid ${B.border}`, paddingTop: 10,
              }}>{result.output}</div>
            )}
          </div>
        )}
      </div>

      {/* Coming soon */}
      <div style={{
        flex: 1, background: B.white, border: `1px solid ${B.border}`,
        borderRadius: 10, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 220,
        boxShadow: '0 1px 4px rgba(0,0,0,.05)',
      }}>
        <div style={{
          width: 56, height: 56, background: B.orangeBg,
          borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 26 }}>{mod.icon}</span>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: "'Russo One',sans-serif", fontSize: 16, color: B.black,
            letterSpacing: 0.3, marginBottom: 6,
          }}>{mod.label}</div>
          <div style={{
            fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.muted,
          }}>Coming soon</div>
        </div>
        <div style={{
          background: `${B.orange}14`, border: `1px solid ${B.orange}40`,
          borderRadius: 20, padding: '4px 14px',
          fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8,
          color: B.orange, letterSpacing: 2,
        }}>IN DEVELOPMENT</div>
      </div>
    </div>
  )
}

function Chip({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{
        fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7,
        color: B.muted, letterSpacing: 1.5,
      }}>{label}</span>
      <span style={{
        fontFamily: "'Lexend',sans-serif", fontSize: 11, fontWeight: 500,
        color: B.orange, background: B.orangeBg,
        border: `1px solid ${B.orange}30`, borderRadius: 4,
        padding: '2px 8px', display: 'inline-block',
      }}>{value || '—'}</span>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function CommandCenter() {
  const userRole      = getStoredRole()
  const [activeId, setActiveId] = useState('sales-copy')
  const [slim,     setSlim]     = useState(false)

  const visibleModules = MODULES.filter(m => !m.adminOnly || userRole === 'admin')
  const activeMod      = visibleModules.find(m => m.id === activeId) || visibleModules[0]

  return (
    <div style={{
      display: 'flex', height: '100vh', background: B.pageBg, overflow: 'hidden',
      fontFamily: "'Lexend',sans-serif", color: B.text,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Russo+One&family=Lexend+Zetta:wght@700;900&family=Lexend:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-thumb{background:${B.orange};border-radius:2px}
        button{cursor:pointer;font-family:'Lexend',sans-serif;transition:all .12s}
        button:hover{opacity:.82} button:active{transform:scale(.97)}
        input,textarea,select{font-family:'Lexend',sans-serif;outline:none}
      `}</style>

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      <aside style={{
        width: slim ? 52 : 220, background: B.white,
        borderRight: `1px solid ${B.border}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        transition: 'width .18s', overflow: 'hidden',
        boxShadow: '1px 0 4px rgba(0,0,0,.04)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 10px 12px', borderBottom: `1px solid ${B.border}`,
          display: 'flex', alignItems: 'center',
          justifyContent: slim ? 'center' : 'space-between', minHeight: 60,
        }}>
          {!slim && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 30, height: 30, background: B.orange, borderRadius: 5,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <span style={{ fontFamily: "'Russo One',sans-serif", fontSize: 11, color: B.white, letterSpacing: -1 }}>ST1</span>
              </div>
              <div>
                <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 12, color: B.black, letterSpacing: 0.3 }}>COMMAND</div>
                <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 6, color: B.orange, letterSpacing: 2 }}>CENTER</div>
              </div>
            </div>
          )}
          {slim && (
            <div style={{
              width: 30, height: 30, background: B.orange, borderRadius: 5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontFamily: "'Russo One',sans-serif", fontSize: 11, color: B.white, letterSpacing: -1 }}>ST1</span>
            </div>
          )}
          <button
            onClick={() => setSlim(c => !c)}
            style={{ background: 'none', border: 'none', color: B.muted, fontSize: 13, padding: 2, flexShrink: 0, marginLeft: slim ? 0 : 2 }}
          >
            {slim ? '→' : '←'}
          </button>
        </div>

        {/* Back to RevOps */}
        {!slim && (
          <a
            href="/"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none',
              padding: '7px 11px 7px 10px', borderBottom: `1px solid ${B.border}`,
              fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.muted,
              letterSpacing: 1, borderLeft: '3px solid transparent',
            }}
          >
            <span style={{ fontSize: 10 }}>←</span>
            <span>BACK TO REVOPS</span>
          </a>
        )}
        {slim && (
          <a
            href="/"
            title="Back to RevOps"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              textDecoration: 'none', padding: '8px 0', borderBottom: `1px solid ${B.border}`,
              color: B.muted, fontSize: 11,
            }}
          >←</a>
        )}

        {/* Section label */}
        {!slim && (
          <div style={{
            padding: '10px 13px 3px',
            fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted,
            letterSpacing: 2, opacity: 0.7,
          }}>MODULES</div>
        )}
        {slim && <div style={{ height: 1, background: B.border, margin: '5px 8px' }} />}

        {/* Module list */}
        <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingTop: 4 }}>
          {visibleModules.map(m => {
            const active = m.id === activeMod.id
            return (
              <button
                key={m.id}
                onClick={() => setActiveId(m.id)}
                title={slim ? m.label : undefined}
                style={{
                  width: '100%', textAlign: 'left',
                  background: active ? `${B.orange}14` : 'transparent',
                  border: 'none',
                  borderLeft: `3px solid ${active ? B.orange : 'transparent'}`,
                  color: active ? B.orange : B.muted,
                  padding: slim ? '9px 0' : '7px 11px 7px 10px',
                  display: 'flex', alignItems: 'center',
                  gap: slim ? 0 : 8,
                  justifyContent: slim ? 'center' : 'flex-start',
                  fontSize: 11, fontWeight: active ? 500 : 400,
                }}
              >
                <span style={{ fontSize: 13, width: 16, textAlign: 'center', flexShrink: 0 }}>{m.icon}</span>
                {!slim && (
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.label}
                  </span>
                )}
                {!slim && m.adminOnly && (
                  <span style={{
                    marginLeft: 'auto', flexShrink: 0,
                    fontFamily: "'Lexend Zetta',sans-serif", fontSize: 6,
                    color: B.orange, background: B.orangeBg,
                    border: `1px solid ${B.orange}30`,
                    borderRadius: 3, padding: '1px 4px', letterSpacing: 0.5,
                  }}>ADMIN</span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Role badge */}
        {!slim && (
          <div style={{
            padding: '9px 11px', borderTop: `1px solid ${B.border}`,
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', background: B.orange,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <span style={{ fontFamily: "'Russo One',sans-serif", fontSize: 9, color: B.white }}>AI</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.text, fontWeight: 500 }}>Command Center</div>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 6, color: B.muted, letterSpacing: 1 }}>{userRole.toUpperCase()}</div>
            </div>
          </div>
        )}
      </aside>

      {/* ── MAIN ────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <header style={{
          background: B.white, borderBottom: `1px solid ${B.border}`,
          height: 46, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 22px',
          flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,.04)',
        }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: B.muted, letterSpacing: 2 }}>
            {activeMod?.label?.toUpperCase()}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{
              background: B.orangeBg, border: `1px solid ${B.orange}40`,
              borderRadius: 4, padding: '3px 10px',
              fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7,
              color: B.orange, letterSpacing: 1.5,
            }}>AI ROUTER ACTIVE</div>
          </div>
        </header>

        {/* Panel */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {activeMod && (
            <PlaceholderPanel mod={activeMod} userRole={userRole} key={activeMod.id} />
          )}
        </div>
      </div>
    </div>
  )
}
