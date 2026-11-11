import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { installSessionFetch } from './lib/session.js'
import './lib/agents/index.js'  // registers Edgar, Brad, Ledger, Annie into plugin registry at startup

// Every same-origin /api/ call carries the signed session (server requires it).
installSessionFetch()

// Hide splash screen once React mounts
window.__hideSplash?.()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)