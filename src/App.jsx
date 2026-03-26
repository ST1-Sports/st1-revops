import React, { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

// Main app shell (deals, briefing, invoicing, reorder, prospecting, etc.)
const RevOps      = lazy(() => import('./pages/RevOps.jsx'))

// Standalone tools — loaded on demand, keep bundle small
const RFPTool     = lazy(() => import('./pages/RFPTool.jsx'))
const PriceTool   = lazy(() => import('./pages/PriceTool.jsx'))
const Expansion   = lazy(() => import('./pages/Expansion.jsx'))
const Integrations= lazy(() => import('./pages/Integrations.jsx'))

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

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Main unified app — handles all daily ops */}
        <Route path="/*"           element={<RevOps />} />

        {/* Standalone tools — opened from within RevOps or directly */}
        <Route path="/rfp"         element={<RFPTool />} />
        <Route path="/prices"      element={<PriceTool />} />
        <Route path="/expansion"   element={<Expansion />} />
        <Route path="/integrations"element={<Integrations />} />

        {/* Catch-all */}
        <Route path="*"            element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}