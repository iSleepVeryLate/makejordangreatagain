import { Routes, Route, Navigate } from 'react-router-dom'
import { RequireAuth, useAuth } from './context/AuthContext.jsx'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import AuthCallback from './pages/AuthCallback.jsx'
import Lobby from './pages/Lobby.jsx'
import Game from './pages/Game.jsx'
import Leaderboard from './pages/Leaderboard.jsx'
import Profile from './pages/Profile.jsx'

function MeRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return null
  if (!profile) return <Navigate to="/login" replace />
  return <Navigate to={`/profile/${profile.id}`} replace />
}

export default function App() {
  return (
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
  )
}
