import React, { useState, useEffect } from 'react'
import { getAllPlugins, registerPlugin, setPluginEnabled, deleteCustomTool, loadCustomTools } from '../lib/plugins/index.js'
import '../lib/agents/index.js'  // registers Edgar + Brad into the plugin registry

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
  yellow:   '#C77800',
  yellowBg: '#FFF8E6',
  red:      '#C0392B',
  redBg:    '#FDECEA',
}

const TYPE_LABELS = { claude: 'Claude AI', 'claude-search': 'Claude + Search', ideogram: 'Ideogram AI', agent: 'ST1 Agent', webhook: 'Webhook', api: 'API', embed: 'Embed', iframe: 'iFrame' }

function pluginStatus(p) {
  if (p.custom) {
    const hasUrl = !!(p.config?.webhookUrl || p.config?.apiUrl || p.config?.embedUrl)
    return hasUrl ? 'configured' : 'needs_config'
  }
  return p.requiresKeys?.length ? 'needs_key' : 'configured'
}

function StatusDot({ status, enabled }) {
  if (!enabled) return <span style={{ width: 8, height: 8, borderRadius: '50%', background: B.gray2, display: 'inline-block', flexShrink: 0 }} title="Disabled" />
  const color = status === 'configured' ? B.green : B.yellow
  const label = status === 'configured' ? 'Ready' : status === 'needs_key' ? 'Needs API key' : 'Needs config'
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} title={label} />
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 34, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer', flexShrink: 0,
        background: checked ? B.orange : B.gray2, position: 'relative', transition: 'background .15s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2, width: 14, height: 14,
        borderRadius: '50%', background: B.white, transition: 'left .15s',
        boxShadow: '0 1px 2px rgba(0,0,0,.25)',
      }} />
    </button>
  )
}

function CapTag({ label }) {
  return (
    <span style={{
      fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, letterSpacing: 0.5,
      color: B.orange, background: B.orangeBg, border: `1px solid ${B.orange}30`,
      borderRadius: 3, padding: '2px 6px',
    }}>{label}</span>
  )
}

function CapInput({ value, onChange }) {
  const [input, setInput] = useState('')
  const tags = value.filter(Boolean)

  function add(raw) {
    const next = raw.trim().toLowerCase().replace(/\s+/g, '-')
    if (next && !tags.includes(next)) onChange([...tags, next])
    setInput('')
  }

  function remove(tag) { onChange(tags.filter(t => t !== tag)) }

  return (
    <div style={{ border: `1px solid ${B.border}`, borderRadius: 6, background: B.surface, padding: '6px 8px', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {tags.map(t => (
        <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 3, background: B.orangeBg, border: `1px solid ${B.orange}30`, borderRadius: 3, padding: '2px 6px', fontSize: 10, fontFamily: "'Lexend',sans-serif", color: B.orange }}>
          {t}
          <button onClick={() => remove(t)} style={{ background: 'none', border: 'none', color: B.orange, padding: 0, lineHeight: 1, fontSize: 11, cursor: 'pointer' }}>×</button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input) } }}
        onBlur={() => input.trim() && add(input)}
        placeholder={tags.length ? '' : 'copy, social, general… (Enter to add)'}
        style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 11, fontFamily: "'Lexend',sans-serif", color: B.text, minWidth: 120 }}
      />
    </div>
  )
}

const EMPTY_FORM = { name: '', capabilities: [], type: 'webhook', webhookUrl: '', notes: '' }

export default function ToolManager() {
  const [plugins,   setPlugins]   = useState([])
  const [showForm,  setShowForm]  = useState(false)
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [flash,     setFlash]     = useState('')   // success message

  function reload() { setPlugins(getAllPlugins()) }

  useEffect(() => {
    loadCustomTools().then(() => reload())
  }, [])

  async function handleToggle(plugin) {
    const nextEnabled = plugin.enabled === false
    setPluginEnabled(plugin.id, nextEnabled)
    reload()
    if (!plugin.custom) return // built-in plugins aren't stored in /api/admin/tools
    try {
      await fetch('/api/admin/tools', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          id: plugin.id, name: plugin.name, capabilities: plugin.capabilities,
          type: plugin.type, config: plugin.config, roles: plugin.roles,
          custom: true, enabled: nextEnabled,
        }),
      })
    } catch (e) {
      setFlash(`error:Toggle saved locally but failed to sync: ${e.message}`)
    }
  }

  async function handleDelete(plugin) {
    if (!window.confirm(`Delete "${plugin.name}"? This cannot be undone.`)) return
    try {
      const r = await fetch(`/api/admin/tools?id=${encodeURIComponent(plugin.id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch (e) {
      setFlash(`error:Failed to delete: ${e.message}`)
      return
    }
    deleteCustomTool(plugin.id)
    reload()
  }

  async function handleAdd() {
    const name = form.name.trim()
    const caps = form.capabilities.filter(Boolean)
    if (!name || !caps.length) {
      setFlash('error:Name and at least one capability are required.')
      return
    }
    const tool = {
      id:           `custom_${Date.now().toString(36)}`,
      name,
      capabilities: caps,
      type:         form.type,
      config:       { webhookUrl: form.webhookUrl.trim(), notes: form.notes.trim() },
      enabled:      true,
      roles:        ['admin'],
      custom:       true,
    }
    try {
      const r = await fetch('/api/admin/tools', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(tool),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch (e) {
      setFlash(`error:Failed to save: ${e.message}`)
      return
    }
    registerPlugin(tool)
    reload()
    setForm(EMPTY_FORM)
    setShowForm(false)
    setFlash('ok:Tool registered successfully.')
    setTimeout(() => setFlash(''), 3000)
  }

  const [isOk, flashMsg] = flash.startsWith('ok:')
    ? [true,  flash.slice(3)]
    : flash.startsWith('error:')
      ? [false, flash.slice(6)]
      : [true, '']

  const builtIns = plugins.filter(p => !p.custom)
  const customs  = plugins.filter(p =>  p.custom)

  const inp = { width: '100%', background: B.surface, border: `1px solid ${B.border}`, borderRadius: 6, padding: '8px 11px', fontSize: 11, fontFamily: "'Lexend',sans-serif", color: B.text, outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '4px 0' }}>

      {/* ── Flash ── */}
      {flashMsg && (
        <div style={{ margin: '0 0 14px', padding: '9px 14px', background: isOk ? B.greenBg : B.redBg, border: `1px solid ${isOk ? B.green : B.red}30`, borderRadius: 6, fontFamily: "'Lexend',sans-serif", fontSize: 11, color: isOk ? B.green : B.red }}>
          {flashMsg}
        </div>
      )}

      {/* ── Built-in plugins ── */}
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 8 }}>BUILT-IN PLUGINS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        {builtIns.map(p => (
          <PluginRow key={p.id} plugin={p} onToggle={handleToggle} onDelete={null} />
        ))}
      </div>

      {/* ── Custom tools ── */}
      {customs.length > 0 && (
        <>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 2, marginBottom: 8 }}>CUSTOM TOOLS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
            {customs.map(p => (
              <PluginRow key={p.id} plugin={p} onToggle={handleToggle} onDelete={handleDelete} />
            ))}
          </div>
        </>
      )}

      {/* ── Add Tool ── */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          style={{ background: B.orange, color: B.white, border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'pointer' }}
        >
          + ADD TOOL
        </button>
      )}

      {showForm && (
        <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.orange, letterSpacing: 2, marginBottom: 14 }}>ADD CUSTOM TOOL</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, display: 'block', marginBottom: 4 }}>TOOL NAME *</label>
              <input style={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. My Webhook Tool" />
            </div>
            <div>
              <label style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, display: 'block', marginBottom: 4 }}>TYPE</label>
              <select style={{ ...inp, cursor: 'pointer' }} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="webhook">Webhook</option>
                <option value="api">API</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, display: 'block', marginBottom: 4 }}>CAPABILITY TAGS * <span style={{ fontFamily: "'Lexend',sans-serif", fontWeight: 400, letterSpacing: 0, fontSize: 9, color: B.muted }}>(type + Enter)</span></label>
            <CapInput value={form.capabilities} onChange={caps => setForm(f => ({ ...f, capabilities: caps }))} />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, display: 'block', marginBottom: 4 }}>
              {form.type === 'iframe' || form.type === 'embed' ? 'EMBED URL' : 'WEBHOOK / API URL'}
            </label>
            <input style={inp} value={form.webhookUrl} onChange={e => setForm(f => ({ ...f, webhookUrl: e.target.value }))} placeholder="https://…" />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, color: B.muted, letterSpacing: 1.5, display: 'block', marginBottom: 4 }}>NOTES</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Optional notes about this tool…"
              style={{ ...inp, resize: 'vertical', minHeight: 48 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleAdd} style={{ background: B.orange, color: B.white, border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", letterSpacing: 0.5, cursor: 'pointer' }}>REGISTER TOOL</button>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }} style={{ background: B.surface, color: B.muted, border: `1px solid ${B.border}`, borderRadius: 6, padding: '9px 14px', fontSize: 10, fontFamily: "'Lexend',sans-serif", cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function PluginRow({ plugin, onToggle, onDelete }) {
  const enabled = plugin.enabled !== false
  const status  = pluginStatus(plugin)

  return (
    <div style={{
      background: B.white, border: `1px solid ${B.border}`, borderRadius: 8,
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <StatusDot status={status} enabled={enabled} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, fontWeight: 500, color: enabled ? B.text : B.muted }}>
            {plugin.name}
          </span>
          {plugin.custom && (
            <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 6, color: B.orange, background: B.orangeBg, border: `1px solid ${B.orange}30`, borderRadius: 3, padding: '1px 5px', letterSpacing: 0.5 }}>CUSTOM</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {(plugin.capabilities || []).map(c => <CapTag key={c} label={c} />)}
          <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.muted }}>
            {TYPE_LABELS[plugin.type] || plugin.type}
          </span>
          {status === 'needs_key' && (
            <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.yellow }}>
              needs {plugin.requiresKeys?.join(', ')}
            </span>
          )}
          {status === 'needs_config' && (
            <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 9, color: B.yellow }}>needs URL</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {onDelete && (
          <button onClick={() => onDelete(plugin)} style={{ background: 'none', border: 'none', color: B.muted, fontSize: 13, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }} title="Delete">×</button>
        )}
        <Toggle checked={enabled} onChange={() => onToggle(plugin)} />
      </div>
    </div>
  )
}
