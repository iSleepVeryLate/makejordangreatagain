import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { RequireAuth, RequireAdmin, useAuth } from './context/AuthContext.jsx'
import { MOCK_AUTH_ENABLED } from './lib/devAuth.js'
import OfflineBanner from './components/OfflineBanner.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

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

// Jordan Monopoly — N-player board game (own room model, server-authoritative).
const MonopolyHome = lazy(() => import('./pages/MonopolyHome.jsx'))
const MonopolyRoom = lazy(() => import('./pages/MonopolyRoom.jsx'))

// المندس (Al-Mundass) — Jordanian social deduction (own room model, server-authoritative).
const MundassHome = lazy(() => import('./pages/MundassHome.jsx'))
const MundassRoom = lazy(() => import('./pages/MundassRoom.jsx'))

// Public resident-resource pages (no auth required).
const Explore = lazy(() => import('./pages/Explore.jsx'))
const Tourism = lazy(() => import('./pages/Tourism.jsx'))
const Services = lazy(() => import('./pages/Services.jsx'))
const Emergency = lazy(() => import('./pages/Emergency.jsx'))

// MJGA merch shop — public, no auth required.
const Products = lazy(() => import('./pages/Products.jsx'))

// Admin/ops room dashboard — admin-gated (RequireAdmin + server-side checks).
const AdminRooms = lazy(() => import('./pages/AdminRooms.jsx'))

// DEV-ONLY: 3D Monopoly renderer harness (route tree-shaken out of prod builds).
const MonopolyDevHarness = __DEV_SERVER__ ? lazy(() => import('./pages/MonopolyDevHarness.jsx')) : null
// DEV-ONLY: Monopoly HUD harness — renders every HUD surface with mock data so the
// HUD can be reviewed without a login / 2nd player (also tree-shaken out of prod).
const MonopolyHudHarness = __DEV_SERVER__ ? lazy(() => import('./pages/MonopolyHudHarness.jsx')) : null
// DEV-ONLY: المندس harness — canvas/minigames/meeting with mock data, no login.
const MundassDevHarness = __DEV_SERVER__ ? lazy(() => import('./pages/MundassDevHarness.jsx')) : null

function MeRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return null
  if (!profile) return <Navigate to="/login" replace />
  return <Navigate to={`/profile/${profile.id}`} replace />
}

// Resets the boundary when the path changes, so a render error on one page
// doesn't strand the whole app — navigating elsewhere recovers without a reload.
function RoutedErrorBoundary({ children }) {
  const location = useLocation()
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>
}

export default function App() {
  return (
    <Suspense fallback={<div className="page-loader"><div className="spinner" /></div>}>
    <OfflineBanner />
    {MOCK_AUTH_ENABLED && (
      <div className="mock-auth-badge" role="status">⚠ DEV MOCK AUTH — not a real session</div>
    )}
    <RoutedErrorBoundary>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/* Public resident resources — open to everyone, no login required. */}
      <Route path="/explore" element={<Explore />} />
      <Route path="/tourism" element={<Tourism />} />
      <Route path="/services" element={<Services />} />
      <Route path="/emergency" element={<Emergency />} />
      <Route path="/products" element={<Products />} />

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
        path="/monopoly"
        element={
          <RequireAuth>
            <MonopolyHome />
          </RequireAuth>
        }
      />
      <Route
        path="/monopoly/:roomId"
        element={
          <RequireAuth>
            <MonopolyRoom />
          </RequireAuth>
        }
      />
      <Route
        path="/mundass"
        element={
          <RequireAuth>
            <MundassHome />
          </RequireAuth>
        }
      />
      <Route
        path="/mundass/:roomId"
        element={
          <RequireAuth>
            <MundassRoom />
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
      <Route
        path="/admin/rooms"
        element={
          <RequireAdmin>
            <AdminRooms />
          </RequireAdmin>
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

      {__DEV_SERVER__ && MonopolyDevHarness && (
        <Route path="/__dev/monopoly3d" element={<MonopolyDevHarness />} />
      )}
      {__DEV_SERVER__ && MonopolyHudHarness && (
        <Route path="/__dev/monopoly-hud" element={<MonopolyHudHarness />} />
      )}
      {__DEV_SERVER__ && MundassDevHarness && (
        <Route path="/__dev/mundass" element={<MundassDevHarness />} />
      )}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </RoutedErrorBoundary>
    </Suspense>
  )
}
