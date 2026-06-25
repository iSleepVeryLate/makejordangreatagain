import { NavLink, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import BrandMark from './BrandMark.jsx'
import Avatar from './Avatar.jsx'

// Shared shell for the public resource pages (/explore, /tourism, /services,
// /emergency). Unlike AppNav this is auth-aware but does NOT require a session:
// signed-in members see their profile chip, everyone else gets a "Sign in"
// button. Reuses the .appnav styling from app.css.
const DISCORD_INVITE = 'https://discord.gg/makejordangreatagain'

const LINKS = [
  { to: '/explore', label: 'Explore' },
  { to: '/tourism', label: 'Tourism' },
  { to: '/services', label: 'Services' },
  { to: '/emergency', label: 'Emergency' },
  { to: '/play', label: 'Games' },
]

export default function ResourceLayout({ children }) {
  const { session, profile } = useAuth()
  return (
    <>
      <nav className="appnav">
        <div className="app-wrap appnav-inner">
          <BrandMark to="/" />
          <div className="appnav-right">
            <div className="appnav-links res-links">
              {LINKS.map((l) => (
                <NavLink key={l.to} to={l.to}>{l.label}</NavLink>
              ))}
            </div>
            {session && profile ? (
              <NavLink className="user-chip" to={`/profile/${profile.id}`}>
                <Avatar profile={profile} />
                <span className="uname">{profile.global_name || profile.username}</span>
              </NavLink>
            ) : (
              <Link className="btn btn-discord btn-sm" to="/login">Sign in</Link>
            )}
          </div>
        </div>
      </nav>

      <main className="app-main res-main">
        <div className="app-wrap">{children}</div>
      </main>

      <footer className="res-footer">
        <div className="app-wrap res-foot-inner">
          <span>Jordan Stand Tall — a community resource for residents of Jordan.</span>
          <span className="foot-note">
            An independent, non-political community space. Information is provided for convenience;
            please verify official details before relying on them.
          </span>
          <span className="res-foot-verify">
            Listings verified June 2026 ·{' '}
            <a href={DISCORD_INVITE} target="_blank" rel="noopener">Spot something out of date? Tell us</a>
          </span>
        </div>
      </footer>
    </>
  )
}
