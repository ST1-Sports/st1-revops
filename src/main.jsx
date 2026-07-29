import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './lib/agents/index.js'  // registers Edgar, Brad, Ledger, Annie into plugin registry at startup

// Hide splash screen once React mounts
window.__hideSplash?.()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)