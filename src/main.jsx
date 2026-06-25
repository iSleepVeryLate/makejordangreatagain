import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { PresenceProvider } from './context/PresenceContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import { LanguageProvider } from './context/LanguageContext.jsx'
import { registerSW } from './lib/registerSW.js'
import './styles/landing.css'
import './styles/app.css'
import './styles/resources.css'
import './styles/rtl.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <PresenceProvider>
          <ToastProvider>
            <LanguageProvider>
              <App />
            </LanguageProvider>
          </ToastProvider>
        </PresenceProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

registerSW()
