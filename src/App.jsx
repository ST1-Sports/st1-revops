import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'

// Main app shell (deals, briefing, invoicing, reorder, prospecting, etc.)
const RevOps      = lazy(() => import('./pages/RevOps.jsx'))

// Standalone tools — loaded on demand, keep bundle small
const RFPTool     = lazy(() => import('./pages/RFPTool.jsx'))
const PriceTool   = lazy(() => import('./pages/PriceTool.jsx'))
const Expansion   = lazy(() => import('./pages/Expansion.jsx'))
const Integrations= lazy(() => import('./pages/Integrations.jsx'))
const Reddit      = lazy(() => import('./pages/Reddit.jsx'))

// Full-screen loading spinner
function PageLoader() {
  return (
    <div style={{
      height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'#F2F2F0', flexDirection:'column', gap:16,
    }}>
      <div style={{
        width:48, height:48, background:'#F37321', borderRadius:8,
        display:'flex', alignItems:'center', justifyContent:'center',
      }}>
        <span style={{
          fontFamily:"'Russo One',sans-serif", fontSize:17, color:'#fff', letterSpacing:-1
        }}>ST1</span>
      </div>
      <div style={{
        width:32, height:3, background:'#F37321', borderRadius:2,
        animation:'grow 1s ease-in-out infinite alternate',
      }}/>
      <style>{`@keyframes grow{from{width:24px}to{width:56px}}`}</style>
    </div>
  )
}

// Task-done route map — where to navigate when clicking a notification
const TASK_ROUTES = {
  scrape: '/',          // prospecting lives in RevOps
  import: '/prices',    // price list import
  rfp:    '/rfp',
  expansion: '/expansion',
}

// Global background-task notification banner
function BgNotifications() {
  const [toasts, setToasts] = useState([])
  const navigate = useNavigate()
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    if (timers.current[id]) {
      clearTimeout(timers.current[id])
      delete timers.current[id]
    }
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  useEffect(() => {
    const handler = (e) => {
      const task = e.detail
      const isError = task.status === 'error'
      const toast = {
        id:       task.id + '_' + Date.now(),
        taskId:   task.id,
        taskType: task.type || 'task',
        label:    task.label || 'Background task',
        summary:  task.summary || (isError ? 'Something went wrong' : 'Complete'),
        isError,
        route:    TASK_ROUTES[task.type] || null,
      }
      setToasts(t => [toast, ...t.slice(0, 4)])
      // Auto-dismiss after 12 seconds
      timers.current[toast.id] = setTimeout(() => dismiss(toast.id), 12000)
    }
    window.addEventListener('st1:task:done', handler)
    return () => {
      window.removeEventListener('st1:task:done', handler)
      Object.values(timers.current).forEach(clearTimeout)
    }
  }, [dismiss])

  if (!toasts.length) return null

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
    }}>
      {toasts.map(toast => (
        <div key={toast.id} style={{
          background: toast.isError ? '#1a1a1a' : '#111827',
          border: `1px solid ${toast.isError ? '#C0392B' : '#F37321'}`,
          borderLeft: `4px solid ${toast.isError ? '#C0392B' : '#F37321'}`,
          borderRadius: 8,
          padding: '12px 14px',
          minWidth: 280, maxWidth: 360,
          boxShadow: '0 4px 20px rgba(0,0,0,.35)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
          animation: 'slideIn .25s ease',
        }}>
          <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>
            {toast.isError ? '⚠️' : '✅'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: "'Lexend',sans-serif", fontSize: 12, fontWeight: 600,
              color: '#ffffff', marginBottom: 2,
            }}>{toast.label}</div>
            <div style={{
              fontFamily: "'Lexend',sans-serif", fontSize: 11,
              color: toast.isError ? '#f87171' : '#9ca3af',
              lineHeight: 1.4,
            }}>{toast.summary}</div>
            {toast.route && !toast.isError && (
              <button
                onClick={() => { navigate(toast.route); dismiss(toast.id); }}
                style={{
                  marginTop: 7, background: '#F37321', color: '#fff', border: 'none',
                  borderRadius: 4, padding: '4px 10px', fontSize: 10, cursor: 'pointer',
                  fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, letterSpacing: .5,
                }}>
                VIEW RESULTS →
              </button>
            )}
          </div>
          <button onClick={() => dismiss(toast.id)} style={{
            background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0,
          }}>×</button>
        </div>
      ))}
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}`}</style>
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <BgNotifications />
      <Routes>
        {/* Main unified app — handles all daily ops */}
        <Route path="/*"           element={<RevOps />} />

        {/* Standalone tools — opened from within RevOps or directly */}
        <Route path="/rfp"         element={<RFPTool />} />
        <Route path="/prices"      element={<PriceTool />} />
        <Route path="/expansion"   element={<Expansion />} />
        <Route path="/integrations"element={<Integrations />} />
        <Route path="/reddit"      element={<Reddit />} />

        {/* Catch-all */}
        <Route path="*"            element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
