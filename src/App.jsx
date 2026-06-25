import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { RequireAuth, useAuth } from './context/AuthContext.jsx'
import { MOCK_AUTH_ENABLED } from './lib/devAuth.js'
import OfflineBanner from './components/OfflineBanner.jsx'

// Route-level code splitting: each page ships as its own chunk.
const Landing = lazy(() => import('./pages/Landing.jsx'))
const Login = lazy(() => import('./pages/Login.jsx'))
const AuthCallback = lazy(() => import('./pages/AuthCallback.jsx'))
const Lobby = lazy(() => import('./pages/Lobby.jsx'))
const Game = lazy(() => import('./pages/Game.jsx'))
const Leaderboard = lazy(() => import('./pages/Leaderboard.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))

// Draw & Guess — the N-player party game (its own room model, not `matches`).
const DrawHome = lazy(() => import('./pages/DrawHome.jsx'))
const DrawRoom = lazy(() => import('./pages/DrawRoom.jsx'))

// Public resident-resource pages (no auth required).
const Explore = lazy(() => import('./pages/Explore.jsx'))
const Tourism = lazy(() => import('./pages/Tourism.jsx'))
const Services = lazy(() => import('./pages/Services.jsx'))
const Emergency = lazy(() => import('./pages/Emergency.jsx'))

function MeRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return null
  if (!profile) return <Navigate to="/login" replace />
  return <Navigate to={`/profile/${profile.id}`} replace />
}

export default function App() {
  return (
    <Suspense fallback={<div className="page-loader"><div className="spinner" /></div>}>
    <OfflineBanner />
    {MOCK_AUTH_ENABLED && (
      <div className="mock-auth-badge" role="status">⚠ DEV MOCK AUTH — not a real session</div>
    )}
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/* Public resident resources — open to everyone, no login required. */}
      <Route path="/explore" element={<Explore />} />
      <Route path="/tourism" element={<Tourism />} />
      <Route path="/services" element={<Services />} />
      <Route path="/emergency" element={<Emergency />} />

      <Route
        path="/play"
        element={
          <RequireAuth>
            <Lobby />
          </RequireAuth>
        }
      />
      <Route
        path="/play/:matchId"
        element={
          <RequireAuth>
            <Game />
          </RequireAuth>
        }
      />
      <Route
        path="/draw"
        element={
          <RequireAuth>
            <DrawHome />
          </RequireAuth>
        }
      />
      <Route
        path="/draw/:roomId"
        element={
          <RequireAuth>
            <DrawRoom />
          </RequireAuth>
        }
      />
      <Route
        path="/leaderboard"
        element={
          <RequireAuth>
            <Leaderboard />
          </RequireAuth>
        }
      />
      <Route path="/me" element={<MeRedirect />} />
      <Route
        path="/profile/:id"
        element={
          <RequireAuth>
            <Profile />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
