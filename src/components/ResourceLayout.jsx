import { NavLink, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import BrandMark from './BrandMark.jsx'
import Avatar from './Avatar.jsx'
import LangToggle from './LangToggle.jsx'

// Shared shell for the public resource pages (/explore, /tourism, /services,
// /emergency). Auth-aware but never requires a session. The wrapper carries the
// `dir`/`lang` for the active language, so RTL is scoped to these pages only.
const DISCORD_INVITE = 'https://discord.gg/makejordangreatagain'

const LINKS = [
  { to: '/explore', key: 'nav.explore' },
  { to: '/tourism', key: 'nav.tourism' },
  { to: '/services', key: 'nav.services' },
  { to: '/emergency', key: 'nav.emergency' },
  { to: '/products', key: 'nav.shop' },
  { to: '/play', key: 'nav.games' },
]

export default function ResourceLayout({ children }) {
  const { session, profile } = useAuth()
  const { t, dir, lang } = useLang()
  return (
    <div className="res-root" dir={dir} lang={lang}>
      <nav className="appnav">
        <div className="app-wrap appnav-inner">
          <BrandMark to="/" />
          <div className="appnav-right">
            <div className="appnav-links res-links">
              {LINKS.map((l) => (
                <NavLink key={l.to} to={l.to}>{t(l.key)}</NavLink>
              ))}
            </div>
            <LangToggle />
            {session && profile ? (
              <NavLink className="user-chip" to={`/profile/${profile.id}`}>
                <Avatar profile={profile} />
                <span className="uname">{profile.global_name || profile.username}</span>
              </NavLink>
            ) : (
              <Link className="btn btn-discord btn-sm" to="/login">{t('nav.signin')}</Link>
            )}
          </div>
        </div>
      </nav>

      <main className="app-main res-main">
        <div className="app-wrap">{children}</div>
      </main>

      <footer className="res-footer">
        <div className="app-wrap res-foot-inner">
          <span>{t('foot.tagline')}</span>
          <span className="foot-note">{t('foot.note')}</span>
          <span className="res-foot-verify">
            {t('foot.verify')}{' '}
            <a href={DISCORD_INVITE} target="_blank" rel="noopener">{t('foot.report')}</a>
          </span>
        </div>
      </footer>
    </div>
  )
}
