import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { RequireAuth, useAuth } from './context/AuthContext.jsx'

// Route-level code splitting: each page ships as its own chunk.
const Landing = lazy(() => import('./pages/Landing.jsx'))
const Login = lazy(() => import('./pages/Login.jsx'))
const AuthCallback = lazy(() => import('./pages/AuthCallback.jsx'))
const Lobby = lazy(() => import('./pages/Lobby.jsx'))
const Game = lazy(() => import('./pages/Game.jsx'))
const Leaderboard = lazy(() => import('./pages/Leaderboard.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))

function MeRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return null
  if (!profile) return <Navigate to="/login" replace />
  return <Navigate to={`/profile/${profile.id}`} replace />
}

export default function App() {
  return (
    <Suspense fallback={<div className="page-loader"><div className="spinner" /></div>}>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

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
