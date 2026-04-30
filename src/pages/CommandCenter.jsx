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

// ─── SHARED ATOMS ────────────────────────────────────────────────────────────
const IS = { width:'100%', background:B.surface, border:`1px solid ${B.border}`, borderRadius:6, padding:'9px 12px', fontSize:12, fontFamily:"'Lexend',sans-serif", color:B.text, outline:'none' }

function Card({ children, style }) {
  return <div style={{ background:B.white, border:`1px solid ${B.border}`, borderRadius:10, padding:20, boxShadow:'0 1px 4px rgba(0,0,0,.05)', marginBottom:14, ...style }}>{children}</div>
}
function Field({ label, children }) {
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ fontFamily:"'Lexend Zetta',sans-serif", fontSize:7, color:B.muted, letterSpacing:1.5, marginBottom:4 }}>{label}</div>
      {children}
    </div>
  )
}
function Row2({ children }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>{children}</div>
}
function Inp(p) { return <input style={IS} {...p} /> }
function Sel({ children, ...p }) { return <select style={{ ...IS, cursor:'pointer' }} {...p}>{children}</select> }
function Tarea(p) { return <textarea style={{ ...IS, resize:'vertical', minHeight:72 }} {...p} /> }

function GenBtn({ onClick, loading, disabled, label='GENERATE →' }) {
  return (
    <button onClick={onClick} disabled={loading||disabled} style={{ background:(loading||disabled)?B.gray2:B.orange, color:B.white, border:'none', borderRadius:6, padding:'10px 22px', fontSize:11, fontFamily:"'Lexend Zetta',sans-serif", letterSpacing:.5, cursor:(loading||disabled)?'default':'pointer', flexShrink:0 }}>
      {loading ? 'GENERATING…' : label}
    </button>
  )
}
function CopyBtn({ text, label='COPY' }) {
  const [ok, setOk] = useState(false)
  function copy() { navigator.clipboard?.writeText(text).catch(()=>{}); setOk(true); setTimeout(()=>setOk(false),1500) }
  return (
    <button onClick={copy} style={{ background:ok?B.greenBg:B.surface, color:ok?B.green:B.muted, border:`1px solid ${ok?B.green:B.border}`, borderRadius:4, padding:'4px 10px', fontSize:9, fontFamily:"'Lexend Zetta',sans-serif", letterSpacing:.5, cursor:'pointer', flexShrink:0 }}>
      {ok ? '✓ COPIED' : label}
    </button>
  )
}
function ErrMsg({ msg }) {
  if (!msg) return null
  return <div style={{ margin:'10px 0', padding:'9px 14px', background:B.redBg, border:`1px solid ${B.red}30`, borderRadius:6, fontFamily:"'Lexend',sans-serif", fontSize:11, color:B.red }}>{msg}</div>
}
function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
      <div onClick={()=>onChange(!checked)} style={{ width:34, height:18, borderRadius:9, background:checked?B.orange:B.gray2, position:'relative', transition:'background .15s', flexShrink:0 }}>
        <span style={{ position:'absolute', top:2, left:checked?18:2, width:14, height:14, borderRadius:'50%', background:B.white, transition:'left .15s', boxShadow:'0 1px 2px rgba(0,0,0,.25)' }}/>
      </div>
      <span style={{ fontFamily:"'Lexend Zetta',sans-serif", fontSize:8, color:checked?B.orange:B.muted, letterSpacing:1 }}>{label}</span>
    </label>
  )
}
function ModHeader({ icon, label, desc }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:22 }}>
      <div style={{ width:40, height:40, background:B.orange, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:18 }}>{icon}</div>
      <div>
        <h1 style={{ fontFamily:"'Russo One',sans-serif", fontSize:20, color:B.black, letterSpacing:.3, margin:0 }}>{label}</h1>
        <p style={{ fontFamily:"'Lexend',sans-serif", fontSize:11, color:B.muted, margin:'3px 0 0', lineHeight:1.5 }}>{desc}</p>
      </div>
    </div>
  )
}

// ─── SALES COPYWRITER ─────────────────────────────────────────────────────────
const EMAIL_TYPES = ['Cold Outreach','Follow-Up','RFP Response','Re-engagement','Seasonal Promo']
const COPY_SYS =
  'You are a B2B sales copywriter for ST1 Sports, a nationwide athletic equipment supplier ' +
  'carrying Wilson, DeMarini, Louisville Slugger, EvoShield, Warstic, Diamond, All-Star, Molten, ' +
  'Gill Athletics, ATEC and more. Primary customers are K-12 athletic directors and coaches at ' +
  'tax-exempt institutions. Under 200 words per variant, direct and sport-specific.'
const BWTF_NOTE =
  ' ST1 acquired BWTF (Bruce Whiting Track & Field) giving strong brand recognition in ' +
  'Minnesota and North Dakota — lean into BWTF heritage and regional trust.'

function parseVariants(text) {
  if (!text) return []
  try { const p = JSON.parse(text.trim()); if (Array.isArray(p) && p.length) return p.slice(0,3) } catch {}
  try { const m = text.match(/\[[\s\S]*\]/); if (m) { const p = JSON.parse(m[0]); if (Array.isArray(p)) return p.slice(0,3) } } catch {}
  const chunks = text.split(/\n(?=(?:Variant|Email|Option)?\s*[123]\b|---)/i).filter(c => c.trim().length > 20)
  if (chunks.length >= 2) return chunks.slice(0,3).map(c => {
    const sub = c.match(/Subject[:\s]+(.+)/i)
    return { subject: sub?.[1]?.trim() || '', body: c.replace(/Subject[:\s]+.+\n?/i,'').trim() }
  })
  return [{ subject: '', body: text.trim() }]
}

function SalesCopyModule({ userRole }) {
  const [emailType, setEmailType] = useState('Cold Outreach')
  const [prospect,  setProspect]  = useState('')
  const [org,       setOrg]       = useState('')
  const [sport,     setSport]     = useState('')
  const [context,   setContext]   = useState('')
  const [bwtf,      setBwtf]      = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [variants,  setVariants]  = useState(null)
  const [error,     setError]     = useState(null)

  async function generate() {
    if (!prospect.trim()) return
    setLoading(true); setError(null); setVariants(null)
    const sys  = bwtf ? COPY_SYS + BWTF_NOTE : COPY_SYS
    const task = [
      sys,
      `Write 3 distinct "${emailType}" email variants to ${prospect.trim()}${org.trim() ? ` at ${org.trim()}` : ''}.`,
      sport.trim()   ? `Sport/activity: ${sport.trim()}.`   : '',
      context.trim() ? `Context: ${context.trim()}.`         : '',
      'Return JSON only — no extra text: [{"subject":"...","body":"..."},{"subject":"...","body":"..."},{"subject":"...","body":"..."}]',
    ].filter(Boolean).join(' ')
    try {
      const r = await routeTask({ task, input: { emailType, prospect, org, sport, context, bwtf }, userRole })
      setVariants(parseVariants(r.output || ''))
    } catch(e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding:28, overflowY:'auto', flex:1 }}>
      <ModHeader icon="✍" label="Sales Copywriter" desc="3 AI-drafted email variants tailored to your prospect, sport, and deal context." />
      <Card>
        <Row2>
          <Field label="EMAIL TYPE">
            <Sel value={emailType} onChange={e=>setEmailType(e.target.value)}>
              {EMAIL_TYPES.map(t=><option key={t}>{t}</option>)}
            </Sel>
          </Field>
          <Field label="SPORT / ACTIVITY">
            <Inp value={sport} onChange={e=>setSport(e.target.value)} placeholder="Baseball, Track & Field, Soccer…" />
          </Field>
        </Row2>
        <Row2>
          <Field label="PROSPECT NAME *">
            <Inp value={prospect} onChange={e=>setProspect(e.target.value)} placeholder="Coach Smith" />
          </Field>
          <Field label="ORGANIZATION">
            <Inp value={org} onChange={e=>setOrg(e.target.value)} placeholder="Lincoln High School" />
          </Field>
        </Row2>
        <Field label="ADDITIONAL CONTEXT">
          <Tarea value={context} onChange={e=>setContext(e.target.value)} rows={3} placeholder="Previous conversations, specific needs, budget context…" />
        </Field>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:4 }}>
          <Toggle checked={bwtf} onChange={setBwtf} label="BWTF MODE (MN / ND)" />
          <GenBtn onClick={generate} loading={loading} disabled={!prospect.trim()} />
        </div>
      </Card>

      <ErrMsg msg={error} />

      {variants && variants.map((v, i) => (
        <Card key={i}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <span style={{ fontFamily:"'Lexend Zetta',sans-serif", fontSize:8, color:B.orange, letterSpacing:2 }}>VARIANT {i+1}</span>
            <CopyBtn text={v.subject ? `Subject: ${v.subject}\n\n${v.body}` : v.body} />
          </div>
          {v.subject && (
            <div style={{ background:B.surface, border:`1px solid ${B.border}`, borderRadius:5, padding:'7px 11px', marginBottom:10 }}>
              <div style={{ fontFamily:"'Lexend Zetta',sans-serif", fontSize:7, color:B.muted, letterSpacing:1.5, marginBottom:3 }}>SUBJECT</div>
              <div style={{ fontFamily:"'Lexend',sans-serif", fontSize:12, color:B.text, fontWeight:500 }}>{v.subject}</div>
            </div>
          )}
          <div style={{ fontFamily:"'Lexend',sans-serif", fontSize:12, color:B.text, lineHeight:1.75, whiteSpace:'pre-wrap' }}>{v.body}</div>
        </Card>
      ))}
    </div>
  )
}

// ─── PLACEHOLDER (remaining modules) ─────────────────────────────────────────
function PlaceholderPanel({ mod }) {
  return (
    <div style={{ padding:28, flex:1, display:'flex', flexDirection:'column' }}>
      <ModHeader icon={mod.icon} label={mod.label} desc={mod.desc} />
      <div style={{ flex:1, background:B.white, border:`1px solid ${B.border}`, borderRadius:10, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, minHeight:220 }}>
        <div style={{ width:52, height:52, background:B.orangeBg, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', fontSize:24 }}>{mod.icon}</div>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontFamily:"'Russo One',sans-serif", fontSize:15, color:B.black, marginBottom:5 }}>{mod.label}</div>
          <div style={{ fontFamily:"'Lexend',sans-serif", fontSize:12, color:B.muted }}>Coming soon</div>
        </div>
        <div style={{ background:`${B.orange}14`, border:`1px solid ${B.orange}40`, borderRadius:20, padding:'4px 14px', fontFamily:"'Lexend Zetta',sans-serif", fontSize:8, color:B.orange, letterSpacing:2 }}>IN DEVELOPMENT</div>
      </div>
    </div>
  )
}

function ActivePanel({ mod, userRole }) {
  if (mod.id === 'sales-copy') return <SalesCopyModule userRole={userRole} />
  return <PlaceholderPanel mod={mod} />
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
            <ActivePanel mod={activeMod} userRole={userRole} key={activeMod.id} />
          )}
        </div>
      </div>
    </div>
  )
}
