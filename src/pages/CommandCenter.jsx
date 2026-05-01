import React, { useState } from 'react'
import { routeTask } from '../lib/aiRouter.js'
import ToolManagerComponent from '../components/ToolManager.jsx'
import AdHubModule from '../components/AdHubModule.jsx'
import AnalyticsWidget from '../components/AnalyticsWidget.jsx'

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
    id:   'ad-hub',
    icon: '📊',
    label: 'Ad Hub',
    cap:  'workflow',
    desc: 'Unified ad analytics, campaign management, and creative launch across all platforms.',
  },
  {
    id:        'analytics',
    icon:      '📈',
    label:     'Analytics',
    cap:       'workflow',
    desc:      'Google Analytics 4 real-time traffic and Google Tag Manager container status.',
    adminOnly: true,
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

// ─── SOCIAL MEDIA ────────────────────────────────────────────────────────────
const PLATFORMS = ['Instagram','Facebook','LinkedIn']
const TONES     = ['Hype','Professional','Educational']

function parseSocial(text, platforms) {
  try { const p = JSON.parse(text.trim()); if (p && typeof p === 'object') return p } catch {}
  try { const m = text.match(/\{[\s\S]*\}/); if (m) { const p = JSON.parse(m[0]); if (typeof p === 'object') return p } } catch {}
  // fallback: one block per platform
  return Object.fromEntries(platforms.map(pl => [pl.toLowerCase(), { caption: text.trim(), hashtags: [] }]))
}

function SocialModule({ userRole }) {
  const [selPlatforms, setSelPlatforms] = useState(['Instagram','LinkedIn'])
  const [topic,        setTopic]        = useState('')
  const [product,      setProduct]      = useState('')
  const [tone,         setTone]         = useState('Professional')
  const [loading,      setLoading]      = useState(false)
  const [result,       setResult]       = useState(null)
  const [error,        setError]        = useState(null)

  function togglePlatform(pl) {
    setSelPlatforms(prev =>
      prev.includes(pl) ? prev.filter(p => p !== pl) : [...prev, pl]
    )
  }

  async function generate() {
    if (!topic.trim() || !selPlatforms.length) return
    setLoading(true); setError(null); setResult(null)
    const platformList = selPlatforms.join(', ')
    const task = [
      `Write optimized social media posts for ${platformList} about: ${topic.trim()}.`,
      product.trim() ? `Product or brand featured: ${product.trim()}.` : '',
      `Tone: ${tone}. ST1 Sports athletic equipment brand context.`,
      'Include platform-appropriate hashtags (5–10 per platform).',
      `Return JSON only: {${selPlatforms.map(p=>`"${p.toLowerCase()}":{"caption":"...","hashtags":["#..."]}`).join(',')}}`,
    ].filter(Boolean).join(' ')
    try {
      const r = await routeTask({ task, input: { platforms: selPlatforms, topic, product, tone }, userRole })
      setResult(parseSocial(r.output || '', selPlatforms))
    } catch(e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const PLATFORM_COLORS = { Instagram:'#E4405F', Facebook:'#1877F2', LinkedIn:'#0A66C2' }

  return (
    <div style={{ padding:28, overflowY:'auto', flex:1 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <ModHeader icon="📱" label="Social" desc="Platform-optimized posts with tailored hashtag sets for each channel." />
        <a href="https://publer.com" target="_blank" rel="noreferrer" style={{ background:B.surface, border:`1px solid ${B.border}`, borderRadius:6, padding:'7px 14px', fontSize:10, fontFamily:"'Lexend Zetta',sans-serif", fontWeight:700, letterSpacing:.5, color:B.text, textDecoration:'none', flexShrink:0 }}>SCHEDULE IN PUBLER ↗</a>
      </div>

      <Card>
        {/* Platform selector */}
        <Field label="PLATFORMS *">
          <div style={{ display:'flex', gap:6 }}>
            {PLATFORMS.map(pl => {
              const active = selPlatforms.includes(pl)
              return (
                <button key={pl} onClick={() => togglePlatform(pl)} style={{ background: active ? PLATFORM_COLORS[pl] : B.surface, color: active ? B.white : B.muted, border: `1px solid ${active ? PLATFORM_COLORS[pl] : B.border}`, borderRadius:6, padding:'6px 14px', fontSize:11, fontFamily:"'Lexend',sans-serif", cursor:'pointer', fontWeight: active ? 600 : 400 }}>
                  {pl}
                </button>
              )
            })}
          </div>
        </Field>

        <Row2>
          <Field label="TOPIC *">
            <Inp value={topic} onChange={e=>setTopic(e.target.value)} placeholder="New baseball season gear, track meet prep…" />
          </Field>
          <Field label="PRODUCT OR BRAND">
            <Inp value={product} onChange={e=>setProduct(e.target.value)} placeholder="Wilson A2000, DeMarini CF, BWTF…" />
          </Field>
        </Row2>

        {/* Tone selector */}
        <Field label="TONE">
          <div style={{ display:'flex', gap:6 }}>
            {TONES.map(t => (
              <button key={t} onClick={() => setTone(t)} style={{ background: tone===t ? B.orange : B.surface, color: tone===t ? B.white : B.muted, border: `1px solid ${tone===t ? B.orange : B.border}`, borderRadius:6, padding:'6px 14px', fontSize:11, fontFamily:"'Lexend',sans-serif", cursor:'pointer', fontWeight: tone===t ? 600 : 400 }}>
                {t}
              </button>
            ))}
          </div>
        </Field>

        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:4 }}>
          <GenBtn onClick={generate} loading={loading} disabled={!topic.trim() || !selPlatforms.length} />
        </div>
      </Card>

      <ErrMsg msg={error} />

      {result && selPlatforms.map(pl => {
        const key  = pl.toLowerCase()
        const data = result[key]
        if (!data) return null
        const color = PLATFORM_COLORS[pl]
        const tags  = Array.isArray(data.hashtags) ? data.hashtags : []
        const full  = data.caption + (tags.length ? '\n\n' + tags.join(' ') : '')
        return (
          <Card key={pl}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <span style={{ fontFamily:"'Lexend Zetta',sans-serif", fontSize:8, color, letterSpacing:2 }}>{pl.toUpperCase()}</span>
              <CopyBtn text={full} />
            </div>
            <div style={{ fontFamily:"'Lexend',sans-serif", fontSize:12, color:B.text, lineHeight:1.75, whiteSpace:'pre-wrap', marginBottom:10 }}>
              {data.caption}
            </div>
            {tags.length > 0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                {tags.map((tag,i) => (
                  <span key={i} style={{ fontFamily:"'Lexend',sans-serif", fontSize:10, color, background:`${color}12`, border:`1px solid ${color}30`, borderRadius:4, padding:'2px 7px' }}>{tag}</span>
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ─── IMAGE GENERATOR ─────────────────────────────────────────────────────────
const USE_CASES = ['Product Promo','Social Post','Email Banner','Event Flyer']
const MOODS     = ['Bold','Clean','Energetic']

const MOOD_STYLE = { Bold:'DESIGN', Clean:'REALISTIC', Energetic:'REALISTIC' }
const CASE_SIZE  = { 'Product Promo':'square', 'Social Post':'square', 'Email Banner':'landscape', 'Event Flyer':'story' }

function ImageModule({ userRole }) {
  const [useCase,   setUseCase]   = useState('Product Promo')
  const [product,   setProduct]   = useState('')
  const [mood,      setMood]      = useState('Clean')
  const [colors,    setColors]    = useState('')
  const [loading,   setLoading]   = useState(false)
  const [imageUrl,  setImageUrl]  = useState(null)
  const [prompt,    setPrompt]    = useState('')
  const [error,     setError]     = useState(null)

  async function generate() {
    if (!product.trim()) return
    setLoading(true); setError(null); setImageUrl(null); setPrompt('')

    // Step 1 — Claude builds the image prompt via routeTask
    const task = [
      `Create an image generation prompt for a "${useCase}" for ST1 Sports athletic equipment brand.`,
      `Featured product or brand: ${product.trim()}.`,
      `Visual mood: ${mood}. Brand colors: orange (#F37321) and black.`,
      colors.trim() ? `Additional colors: ${colors.trim()}.` : '',
      'Athletic sports marketing context. Professional commercial quality.',
      'Return ONLY the image prompt text — no preamble, no explanation.',
    ].filter(Boolean).join(' ')

    try {
      const r = await routeTask({ task, input: { useCase, product, mood, colors }, userRole })
      const builtPrompt = (r.output || '').trim()
      setPrompt(builtPrompt)

      // Step 2 — call image API with the generated prompt
      const imgRes = await fetch('/api/adengine/generate-product-image', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          prompt:  builtPrompt,
          style:   MOOD_STYLE[mood] || 'REALISTIC',
          sizeKey: CASE_SIZE[useCase] || 'square',
        }),
      })
      const imgData = await imgRes.json()
      if (!imgRes.ok) throw new Error(imgData.error || `Image API error ${imgRes.status}`)
      setImageUrl(imgData.imageUrl)
    } catch(e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function download() {
    if (!imageUrl) return
    const a = document.createElement('a')
    a.href = imageUrl
    a.download = `st1-${useCase.toLowerCase().replace(/\s+/g,'-')}-${Date.now()}.jpg`
    a.click()
  }

  return (
    <div style={{ padding:28, overflowY:'auto', flex:1 }}>
      <ModHeader icon="🖼" label="Image Generator" desc="Builds an ST1-branded image prompt via AI, then generates the image with Ideogram." />

      <Card>
        <Row2>
          <Field label="USE CASE">
            <Sel value={useCase} onChange={e=>setUseCase(e.target.value)}>
              {USE_CASES.map(u=><option key={u}>{u}</option>)}
            </Sel>
          </Field>
          <Field label="PRODUCT OR BRAND *">
            <Inp value={product} onChange={e=>setProduct(e.target.value)} placeholder="Wilson A2000, DeMarini CF, BWTF…" />
          </Field>
        </Row2>

        <Field label="MOOD">
          <div style={{ display:'flex', gap:6 }}>
            {MOODS.map(m => (
              <button key={m} onClick={()=>setMood(m)} style={{ background:mood===m?B.orange:B.surface, color:mood===m?B.white:B.muted, border:`1px solid ${mood===m?B.orange:B.border}`, borderRadius:6, padding:'6px 16px', fontSize:11, fontFamily:"'Lexend',sans-serif", cursor:'pointer', fontWeight:mood===m?600:400 }}>
                {m}
              </button>
            ))}
          </div>
        </Field>

        <Field label="ACCENT COLORS (optional)">
          <Inp value={colors} onChange={e=>setColors(e.target.value)} placeholder="e.g. navy blue, gold, white…" />
        </Field>

        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:4 }}>
          <GenBtn onClick={generate} loading={loading} disabled={!product.trim()} label={loading ? 'GENERATING…' : 'GENERATE IMAGE →'} />
        </div>
      </Card>

      <ErrMsg msg={error} />

      {/* Generated prompt (shown for reference) */}
      {prompt && !imageUrl && (
        <Card>
          <div style={{ fontFamily:"'Lexend Zetta',sans-serif", fontSize:7, color:B.muted, letterSpacing:1.5, marginBottom:6 }}>GENERATED PROMPT</div>
          <div style={{ fontFamily:"'Lexend',sans-serif", fontSize:11, color:B.text, lineHeight:1.6 }}>{prompt}</div>
        </Card>
      )}

      {/* Output image */}
      {imageUrl && (
        <Card>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <span style={{ fontFamily:"'Lexend Zetta',sans-serif", fontSize:8, color:B.orange, letterSpacing:2 }}>GENERATED IMAGE</span>
            <div style={{ display:'flex', gap:8 }}>
              <CopyBtn text={prompt} label="COPY PROMPT" />
              <button onClick={download} style={{ background:B.orange, color:B.white, border:'none', borderRadius:4, padding:'4px 12px', fontSize:9, fontFamily:"'Lexend Zetta',sans-serif", letterSpacing:.5, cursor:'pointer' }}>
                DOWNLOAD ↓
              </button>
            </div>
          </div>
          <img src={imageUrl} alt="Generated" style={{ width:'100%', borderRadius:8, display:'block' }} />
          <div style={{ marginTop:10, fontFamily:"'Lexend',sans-serif", fontSize:10, color:B.muted, lineHeight:1.5 }}>
            <strong>Prompt:</strong> {prompt}
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── SMART QUOTE BUILDER ─────────────────────────────────────────────────────
function parseQuote(text) {
  try { const p = JSON.parse(text.trim()); if (p?.items) return p } catch {}
  try { const m = text.match(/\{[\s\S]*\}/); if (m) { const p = JSON.parse(m[0]); if (p?.items) return p } } catch {}
  return null
}

const fmt$ = n => '$' + Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})

function QuoteModule({ userRole }) {
  const [query,      setQuery]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [items,      setItems]      = useState(null)   // [{vendor,sku,description,unitPrice,qty}]
  const [notes,      setNotes]      = useState('')
  const [margin,     setMargin]     = useState(18)
  const [error,      setError]      = useState(null)
  const [quoteText,  setQuoteText]  = useState(null)
  const [sendMsg,    setSendMsg]    = useState('')

  function sellPrice(unitPrice) { return unitPrice * (1 + margin / 100) }
  function lineTotal(item)      { return sellPrice(item.unitPrice) * item.qty }
  const runningTotal = items ? items.reduce((s, item) => s + lineTotal(item), 0) : 0

  function updateQty(i, val) {
    const q = Math.max(1, parseInt(val) || 1)
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, qty: q } : item))
  }

  async function generate() {
    const q = query.trim()
    if (!q) return
    setLoading(true); setError(null); setItems(null); setNotes(''); setQuoteText(null)

    // Fetch matching products first
    let catalog = ''
    try {
      const search = q.split(/\s+/).slice(0,4).join(' ')
      const res    = await fetch(`/api/adengine/products?search=${encodeURIComponent(search)}&pageSize=60`)
      const data   = await res.json()
      const prods  = data.products || []
      catalog = prods.length
        ? 'Product catalog:\n' + prods.map(p =>
            `- ${p.name} | Brand: ${p.brand||'—'} | SKU: ${p.slug} | Price: $${p.price||'0'} | Stock: ${p.stock_status}`
          ).join('\n')
        : 'No catalog data available — estimate based on typical ST1 Sports pricing.'
    } catch { catalog = 'Catalog unavailable — estimate pricing.' }

    const systemPrompt = [
      'You are a sports equipment quoting specialist for ST1 Sports, a nationwide B2B athletic equipment supplier.',
      'Customers are K-12 athletic directors, coaches, and administrators at tax-exempt institutions.',
      catalog,
      'Match products to the customer request. Return ONLY valid JSON in this exact format, no markdown, no explanation:',
      '{"items":[{"vendor":"Brand Name","sku":"SKU-123","description":"Product description","unitPrice":0.00,"qty":1}],"notes":"Any notes or assumptions"}',
    ].join('\n')

    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: `Customer request: ${q}\n\nReturn JSON only.` }],
        }),
      })
      if (!res.ok) {
        const err = await res.text().catch(() => '')
        throw new Error(`AI error ${res.status}${err ? ': ' + err.slice(0, 120) : ''}`)
      }
      const d = await res.json()
      const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
      const parsed = parseQuote(text)
      if (!parsed) throw new Error('Could not parse quote response — try rephrasing your request.')
      setItems((parsed.items || []).map(item => ({ ...item, unitPrice: +item.unitPrice||0, qty: +item.qty||1 })))
      setNotes(parsed.notes || '')
    } catch(e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function buildQuoteText() {
    const lines = items.map(item =>
      `${item.description}\n  Vendor: ${item.vendor}  |  SKU: ${item.sku}  |  Qty: ${item.qty}  |  Unit: ${fmt$(sellPrice(item.unitPrice))}  |  Total: ${fmt$(lineTotal(item))}`
    ).join('\n\n')
    return [
      'ST1 SPORTS — PRICE QUOTATION',
      '─'.repeat(44),
      lines,
      '─'.repeat(44),
      `SUBTOTAL: ${fmt$(runningTotal)}`,
      '',
      'Valid for 30 days. Tax-exempt institutions: please provide exemption certificate.',
      'ST1 Sports  |  matt@st1sports.com  |  719-256-0275',
    ].join('\n')
  }

  const thStyle = { fontFamily:"'Lexend Zetta',sans-serif", fontSize:7, color:B.muted, letterSpacing:1.5, padding:'6px 10px', textAlign:'left', borderBottom:`1px solid ${B.border}`, whiteSpace:'nowrap' }
  const tdStyle = { fontFamily:"'Lexend',sans-serif", fontSize:11, color:B.text, padding:'8px 10px', borderBottom:`1px solid ${B.border}` }

  return (
    <div style={{ padding:28, overflowY:'auto', flex:1 }}>
      <ModHeader icon="▤" label="Smart Quote Builder" desc="Describe what you need in plain English — AI matches your catalog and builds a line-item quote." />

      <Card>
        <Field label="WHAT DO YOU NEED? *">
          <div style={{ display:'flex', gap:8 }}>
            <Inp
              value={query}
              onChange={e=>setQuery(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&generate()}
              placeholder='e.g. "3 dozen NFHS baseballs and 2 batting helmets"'
            />
            <GenBtn onClick={generate} loading={loading} disabled={!query.trim()} />
          </div>
        </Field>
      </Card>

      <ErrMsg msg={error} />

      {items && (
        <>
          {/* Margin slider */}
          <Card style={{ marginBottom:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
              <div style={{ fontFamily:"'Lexend Zetta',sans-serif", fontSize:7, color:B.muted, letterSpacing:1.5 }}>MARGIN</div>
              <input
                type="range" min={0} max={60} value={margin}
                onChange={e=>setMargin(+e.target.value)}
                style={{ flex:1, minWidth:120, accentColor:B.orange }}
              />
              <span style={{ fontFamily:"'Russo One',sans-serif", fontSize:16, color:B.orange, minWidth:40 }}>{margin}%</span>
              <div style={{ fontFamily:"'Lexend Zetta',sans-serif", fontSize:9, color:B.muted, letterSpacing:.5 }}>
                SUBTOTAL <span style={{ color:B.text, fontSize:14, fontFamily:"'Russo One',sans-serif" }}>{fmt$(runningTotal)}</span>
              </div>
            </div>
          </Card>

          {/* Line-item table */}
          <Card style={{ padding:0, overflow:'hidden' }}>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr style={{ background:B.surface }}>
                    <th style={thStyle}>VENDOR</th>
                    <th style={thStyle}>SKU</th>
                    <th style={thStyle}>DESCRIPTION</th>
                    <th style={{ ...thStyle, textAlign:'right' }}>UNIT PRICE</th>
                    <th style={{ ...thStyle, textAlign:'center' }}>QTY</th>
                    <th style={{ ...thStyle, textAlign:'right' }}>LINE TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i}>
                      <td style={tdStyle}>{item.vendor}</td>
                      <td style={{ ...tdStyle, fontFamily:"'Lexend Zetta',sans-serif", fontSize:9, color:B.muted }}>{item.sku}</td>
                      <td style={tdStyle}>{item.description}</td>
                      <td style={{ ...tdStyle, textAlign:'right' }}>{fmt$(sellPrice(item.unitPrice))}</td>
                      <td style={{ ...tdStyle, textAlign:'center' }}>
                        <input
                          type="number" min={1} value={item.qty}
                          onChange={e=>updateQty(i,e.target.value)}
                          style={{ width:52, textAlign:'center', background:B.surface, border:`1px solid ${B.border}`, borderRadius:4, padding:'3px 6px', fontSize:11, fontFamily:"'Lexend',sans-serif", color:B.text }}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign:'right', fontWeight:600 }}>{fmt$(lineTotal(item))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {notes && (
              <div style={{ padding:'10px 14px', borderTop:`1px solid ${B.border}`, fontFamily:"'Lexend',sans-serif", fontSize:11, color:B.muted }}>{notes}</div>
            )}
          </Card>

          {/* Actions */}
          <div style={{ display:'flex', gap:8, marginTop:4 }}>
            <button
              onClick={() => setQuoteText(quoteText ? null : buildQuoteText())}
              style={{ background:B.orange, color:B.white, border:'none', borderRadius:6, padding:'9px 18px', fontSize:10, fontFamily:"'Lexend Zetta',sans-serif", letterSpacing:.5, cursor:'pointer' }}
            >
              {quoteText ? 'HIDE QUOTE' : 'GENERATE QUOTE →'}
            </button>
            <button
              onClick={() => { setSendMsg('Email send coming soon — use Generate Quote to copy and paste.'); setTimeout(()=>setSendMsg(''),3000) }}
              style={{ background:B.surface, color:B.muted, border:`1px solid ${B.border}`, borderRadius:6, padding:'9px 18px', fontSize:10, fontFamily:"'Lexend',sans-serif", cursor:'pointer' }}
            >
              Send to Customer
            </button>
            {sendMsg && <span style={{ fontFamily:"'Lexend',sans-serif", fontSize:10, color:B.muted, alignSelf:'center' }}>{sendMsg}</span>}
          </div>

          {/* Formatted quote */}
          {quoteText && (
            <Card style={{ marginTop:10 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <span style={{ fontFamily:"'Lexend Zetta',sans-serif", fontSize:8, color:B.orange, letterSpacing:2 }}>FORMATTED QUOTE</span>
                <CopyBtn text={quoteText} />
              </div>
              <pre style={{ fontFamily:"'Lexend',sans-serif", fontSize:11, color:B.text, lineHeight:1.7, whiteSpace:'pre-wrap', margin:0 }}>{quoteText}</pre>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

// ─── MODULE 5: RESEARCH & INTEL ──────────────────────────────────────────────
const INTEL_KEY = 'st1_intel'

function linkify(text) {
  const urlRe = /(https?:\/\/[^\s)>\]]+)/g
  const parts = []
  let last = 0, m
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer" style={{ color: B.orange, wordBreak: 'break-all' }}>{m[0]}</a>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function ResearchModule({ userRole }) {
  const [query,   setQuery]   = useState('')
  const [output,  setOutput]  = useState('')
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')
  const [saved,   setSaved]   = useState(false)
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(INTEL_KEY) || '[]') } catch { return [] }
  })

  async function handleRun() {
    if (!query.trim()) return
    setLoading(true); setErr(''); setOutput(''); setSaved(false)
    try {
      const res = await routeTask({ task: query.trim(), input: '', userRole })
      setOutput(res.output || '')
    } catch (e) {
      setErr(e.message || 'Research failed')
    } finally {
      setLoading(false)
    }
  }

  function handleSave() {
    const entry = {
      id:        Date.now(),
      query:     query.trim(),
      output,
      savedAt:   new Date().toISOString(),
    }
    const next = [entry, ...history].slice(0, 50)
    localStorage.setItem(INTEL_KEY, JSON.stringify(next))
    setHistory(next)
    setSaved(true)
  }

  function handleDelete(id) {
    const next = history.filter(e => e.id !== id)
    localStorage.setItem(INTEL_KEY, JSON.stringify(next))
    setHistory(next)
  }

  const paragraphs = output ? output.split(/\n{2,}/) : []

  return (
    <div>
      <ModHeader icon="🔍" label="Research & Intel" desc="Live market research with cited sources. Results are saved to your Intel library." />

      <Card>
        <div style={{ fontFamily:"'Lexend Zetta',sans-serif", fontSize:7, color:B.muted, letterSpacing:1.5, marginBottom:4 }}>RESEARCH QUERY</div>
        <textarea
          value={query}
          onChange={e => setQuery(e.target.value)}
          rows={3}
          placeholder="e.g. What are Lincoln Public Schools buying for fall 2025? What's BSN Sports pricing on Rawlings helmets?"
          style={{ ...IS, resize: 'vertical', minHeight: 70 }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <GenBtn loading={loading} label="RUN RESEARCH" onClick={handleRun} />
          {output && !saved && (
            <button
              onClick={handleSave}
              style={{ background: B.greenBg, color: B.green, border: `1px solid ${B.green}40`, borderRadius: 6, padding: '8px 16px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'pointer' }}
            >
              SAVE TO INTEL
            </button>
          )}
          {saved && <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.green }}>Saved to Intel library</span>}
        </div>
        <ErrMsg msg={err} />
      </Card>

      {output && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2 }}>RESEARCH RESULTS</span>
            <CopyBtn text={output} />
          </div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text, lineHeight: 1.7 }}>
            {paragraphs.map((p, i) => (
              <p key={i} style={{ margin: '0 0 12px' }}>{linkify(p)}</p>
            ))}
          </div>
        </Card>
      )}

      {history.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 10 }}>INTEL LIBRARY</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map(e => (
              <div key={e.id} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, fontWeight: 600, color: B.text, marginBottom: 3 }}>{e.query}</div>
                    <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted }}>{new Date(e.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => { setQuery(e.query); setOutput(e.output); setSaved(true); window.scrollTo(0, 0) }}
                      style={{ background: B.orangeBg, color: B.orange, border: `1px solid ${B.orange}30`, borderRadius: 5, padding: '4px 10px', fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'pointer' }}
                    >
                      VIEW
                    </button>
                    <button
                      onClick={() => handleDelete(e.id)}
                      style={{ background: 'none', border: 'none', color: B.muted, fontSize: 14, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                      title="Delete"
                    >×</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── MODULE 6: FINANCIAL SUMMARIES ───────────────────────────────────────────
const REVOPS_STORE = 'st1_revops_v2'

const REPORT_TYPES = [
  { id: 'monthly-pl',     label: 'Monthly P&L Overview' },
  { id: 'outstanding-ar', label: 'Outstanding Invoices (AR)' },
  { id: 'top-customers',  label: 'Top Customers by Revenue' },
  { id: 'open-quotes',    label: 'Open vs Closed Quotes' },
]

function buildFinanceContext(reportType) {
  let store = {}
  try { store = JSON.parse(localStorage.getItem(REVOPS_STORE) || '{}') } catch {}
  const deals    = Array.isArray(store.deals)    ? store.deals    : []
  const invoices = Array.isArray(store.invoices) ? store.invoices : []
  const contacts = Array.isArray(store.contacts) ? store.contacts : []

  if (reportType === 'monthly-pl') {
    const byMonth = {}
    for (const d of deals) {
      if (!d.closeDate && !d.createdAt) continue
      const key = (d.closeDate || d.createdAt || '').slice(0, 7)
      if (!key) continue
      byMonth[key] = (byMonth[key] || 0) + (parseFloat(d.amount) || 0)
    }
    const rows = Object.entries(byMonth).sort(([a], [b]) => a < b ? 1 : -1).slice(0, 12)
    return `Monthly deal revenue (last 12 months):\n${rows.map(([m, v]) => `${m}: $${v.toLocaleString()}`).join('\n') || 'No data'}\nTotal deals: ${deals.length}`
  }

  if (reportType === 'outstanding-ar') {
    const open = invoices.filter(i => i.status !== 'paid' && i.status !== 'void')
    const total = open.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
    const overdue = open.filter(i => i.dueDate && new Date(i.dueDate) < new Date())
    return `Outstanding AR:\nOpen invoices: ${open.length}\nTotal open: $${total.toLocaleString()}\nOverdue: ${overdue.length} invoices\n\nTop open invoices:\n${open.slice(0, 10).map(i => `- ${i.customerName || i.id}: $${parseFloat(i.amount || 0).toLocaleString()} due ${i.dueDate || 'unknown'}`).join('\n') || 'None'}`
  }

  if (reportType === 'top-customers') {
    const rev = {}
    for (const d of deals) {
      const key = d.contactName || d.accountName || d.customerId || 'Unknown'
      rev[key] = (rev[key] || 0) + (parseFloat(d.amount) || 0)
    }
    const top = Object.entries(rev).sort(([, a], [, b]) => b - a).slice(0, 15)
    return `Top customers by deal revenue:\n${top.map(([name, val], i) => `${i + 1}. ${name}: $${val.toLocaleString()}`).join('\n') || 'No data'}\nTotal contacts: ${contacts.length}`
  }

  if (reportType === 'open-quotes') {
    const open   = deals.filter(d => d.stage !== 'Closed Won' && d.stage !== 'Closed Lost')
    const won    = deals.filter(d => d.stage === 'Closed Won')
    const lost   = deals.filter(d => d.stage === 'Closed Lost')
    const openVal = open.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0)
    const wonVal  = won.reduce((s, d)  => s + (parseFloat(d.amount) || 0), 0)
    return `Quote pipeline:\nOpen quotes: ${open.length} ($${openVal.toLocaleString()})\nClosed Won: ${won.length} ($${wonVal.toLocaleString()})\nClosed Lost: ${lost.length}\n\nOpen by stage:\n${[...new Set(open.map(d => d.stage).filter(Boolean))].map(s => `- ${s}: ${open.filter(d => d.stage === s).length}`).join('\n') || 'No stage data'}`
  }

  return ''
}

function FinancialModule({ userRole }) {
  const [reportType, setReportType] = useState('monthly-pl')
  const [output,     setOutput]     = useState('')
  const [loading,    setLoading]    = useState(false)
  const [err,        setErr]        = useState('')

  async function handleRun() {
    setLoading(true); setErr(''); setOutput('')
    try {
      const ctx  = buildFinanceContext(reportType)
      const label = REPORT_TYPES.find(r => r.id === reportType)?.label || reportType
      const task = `Generate a ${label} financial summary for ST1 Sports. Here is the raw data:\n\n${ctx || 'No data available in the local store yet.'}\n\nProvide an executive-ready narrative summary with key insights, trends, and recommended actions. Format clearly with sections.`
      const res  = await routeTask({ task, input: '', userRole })
      setOutput(res.output || '')
    } catch (e) {
      setErr(e.message || 'Failed to generate summary')
    } finally {
      setLoading(false)
    }
  }

  const paragraphs = output ? output.split(/\n{2,}/) : []

  return (
    <div>
      <ModHeader icon="↑" label="Financial Summaries" desc="AI-generated executive summaries from your live RevOps data." />

      <Card>
        <Field label="REPORT TYPE">
          <Sel value={reportType} onChange={e => setReportType(e.target.value)}>
            {REPORT_TYPES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Sel>
        </Field>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <GenBtn loading={loading} label="GENERATE SUMMARY" onClick={handleRun} />
          {output && <CopyBtn text={output} />}
        </div>
        <ErrMsg msg={err} />
      </Card>

      {output && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 12 }}>
            {REPORT_TYPES.find(r => r.id === reportType)?.label?.toUpperCase()}
          </div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text, lineHeight: 1.75 }}>
            {paragraphs.map((p, i) => (
              <p key={i} style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>{p}</p>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── MODULE 7: TOOL MANAGER (admin) ──────────────────────────────────────────
function ToolManagerModule() {
  return (
    <div>
      <ModHeader icon="⚙" label="Tool Manager" desc="Configure plugins, manage API keys, and control which tools each role can access." />
      <ToolManagerComponent />
    </div>
  )
}

// ─── PRICE LIST INTEL ────────────────────────────────────────────────────────
const COMPETITOR_LIST = [
  'BSN Sports', 'Varsity Brands', 'School Specialty', 'Epic Sports',
  'Eastbay / Foot Locker', 'Amazon Business', 'Dick\'s Sporting Goods',
]

const REPORT_FORMATS = [
  { id: 'battle-card',   label: 'Battle Card' },
  { id: 'price-compare', label: 'Price Comparison Table' },
  { id: 'swot',          label: 'SWOT Analysis' },
  { id: 'objection',     label: 'Objection Handlers' },
]

function PriceIntelModule({ userRole }) {
  const [competitor, setCompetitor] = useState(COMPETITOR_LIST[0])
  const [product,    setProduct]    = useState('')
  const [format,     setFormat]     = useState('battle-card')
  const [extra,      setExtra]      = useState('')
  const [output,     setOutput]     = useState('')
  const [loading,    setLoading]    = useState(false)
  const [err,        setErr]        = useState('')

  async function handleRun() {
    setLoading(true); setErr(''); setOutput('')
    try {
      const fmtLabel = REPORT_FORMATS.find(f => f.id === format)?.label || format
      const task = [
        `Generate a ${fmtLabel} comparing ST1 Sports against ${competitor}.`,
        product ? `Focus on: ${product.trim()}.` : 'Cover athletic equipment broadly.',
        'ST1 Sports carries Wilson, DeMarini, Louisville Slugger, EvoShield, Warstic, Diamond, All-Star, Molten, Gill Athletics, ATEC.',
        'Primary customers are K-12 athletic directors and coaches at tax-exempt institutions.',
        extra.trim() ? `Additional context: ${extra.trim()}` : '',
        format === 'battle-card'
          ? 'Include: key differentiators, ST1 advantages, competitor weaknesses, pricing positioning, and 3 talk tracks.'
          : format === 'price-compare'
          ? 'Research current pricing for common SKUs. Format as a clear comparison with ST1 positioning.'
          : format === 'swot'
          ? 'Produce a SWOT table for ST1 vs this competitor with actionable notes per quadrant.'
          : 'List the top 5 objections this competitor triggers and a sharp ST1 response for each.',
      ].filter(Boolean).join(' ')

      const res = await routeTask({ task, input: '', userRole })
      setOutput(res.output || '')
    } catch (e) {
      setErr(e.message || 'Intel request failed')
    } finally {
      setLoading(false)
    }
  }

  const sections = output
    ? output.split(/\n(?=#{1,3} |\*\*[A-Z])/m).filter(s => s.trim())
    : []

  return (
    <div>
      <ModHeader icon="$" label="Price List Intel" desc="AI-powered competitor analysis, battle cards, and pricing comparisons using live web data." />

      <Card>
        <Row2>
          <Field label="COMPETITOR">
            <Sel value={competitor} onChange={e => setCompetitor(e.target.value)}>
              {COMPETITOR_LIST.map(c => <option key={c} value={c}>{c}</option>)}
            </Sel>
          </Field>
          <Field label="REPORT FORMAT">
            <Sel value={format} onChange={e => setFormat(e.target.value)}>
              {REPORT_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Sel>
          </Field>
        </Row2>
        <Field label="PRODUCT / CATEGORY (OPTIONAL)">
          <Inp
            value={product}
            onChange={e => setProduct(e.target.value)}
            placeholder="e.g. baseball helmets, team uniforms, track & field…"
          />
        </Field>
        <Field label="ADDITIONAL CONTEXT (OPTIONAL)">
          <Tarea
            value={extra}
            onChange={e => setExtra(e.target.value)}
            rows={2}
            placeholder="e.g. prospect just got a BSN quote for $12k, or we're pitching a Minnesota school district…"
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <GenBtn loading={loading} label="GENERATE INTEL" onClick={handleRun} />
          {output && <CopyBtn text={output} />}
        </div>
        <ErrMsg msg={err} />
      </Card>

      {output && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2 }}>
              {REPORT_FORMATS.find(f => f.id === format)?.label?.toUpperCase()} — {competitor.toUpperCase()}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ background: B.orangeBg, color: B.orange, border: `1px solid ${B.orange}30`, borderRadius: 4, padding: '3px 8px', fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, letterSpacing: 0.5 }}>LIVE WEB DATA</span>
            </div>
          </div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
            {sections.length > 1
              ? sections.map((s, i) => (
                  <div key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < sections.length - 1 ? `1px solid ${B.border}` : 'none' }}>
                    {s.trim()}
                  </div>
                ))
              : output}
          </div>
        </Card>
      )}
    </div>
  )
}

function ActivePanel({ mod, userRole }) {
  if (mod.id === 'sales-copy')   return <SalesCopyModule   userRole={userRole} />
  if (mod.id === 'social')       return <SocialModule       userRole={userRole} />
  if (mod.id === 'image')        return <ImageModule        userRole={userRole} />
  if (mod.id === 'quote')        return <QuoteModule        userRole={userRole} />
  if (mod.id === 'price-intel')  return <PriceIntelModule   userRole={userRole} />
  if (mod.id === 'research')     return <ResearchModule     userRole={userRole} />
  if (mod.id === 'finance')      return <FinancialModule    userRole={userRole} />
  if (mod.id === 'ad-hub')       return <AdHubModule       userRole={userRole} />
  if (mod.id === 'analytics')    return <AnalyticsWidget />
  if (mod.id === 'tool-manager') return <ToolManagerModule />
  return <PlaceholderPanel mod={mod} />
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function CommandCenter({ initialModuleId = 'sales-copy', embedded = false }) {
  const userRole      = getStoredRole()
  const [activeId, setActiveId] = useState(initialModuleId)
  const [slim,     setSlim]     = useState(false)

  const visibleModules = MODULES.filter(m => !m.adminOnly || userRole === 'admin')
  const activeMod      = visibleModules.find(m => m.id === activeId) || visibleModules[0]

  if (embedded) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', background: B.pageBg, fontFamily: "'Lexend',sans-serif", color: B.text }}>
        {activeMod && <ActivePanel mod={activeMod} userRole={userRole} key={activeMod.id} />}
      </div>
    )
  }

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
