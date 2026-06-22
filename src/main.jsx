import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { PresenceProvider } from './context/PresenceContext.jsx'
import './styles/landing.css'
import './styles/app.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <PresenceProvider>
          <App />
        </PresenceProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
