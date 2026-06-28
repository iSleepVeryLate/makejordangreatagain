import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import BrandMark from './BrandMark.jsx'
import Avatar from './Avatar.jsx'
import LangToggle from './LangToggle.jsx'
import NotificationBell from './NotificationBell.jsx'

export default function AppNav() {
  const { profile, isAdmin, signOut } = useAuth()
  const { t } = useLang()
  return (
    <nav className="appnav">
      <div className="app-wrap appnav-inner">
        <BrandMark to="/play" />
        <div className="appnav-right">
          <div className="appnav-links">
            <NavLink to="/play">{t('app.nav.games')}</NavLink>
            <NavLink to="/leaderboard">{t('app.nav.leaderboard')}</NavLink>
            <NavLink to="/explore">{t('app.nav.explore')}</NavLink>
            <NavLink to="/products">{t('app.nav.shop')}</NavLink>
            {isAdmin && <NavLink to="/admin/rooms">{t('app.nav.ops')}</NavLink>}
          </div>
          <LangToggle />
          {profile && <NotificationBell />}
          {profile && (
            <NavLink className="user-chip" to={`/profile/${profile.id}`}>
              <Avatar profile={profile} />
              <span className="uname">{profile.global_name || profile.username}</span>
            </NavLink>
          )}
          <button className="btn btn-line btn-sm" onClick={signOut}>{t('app.nav.signout')}</button>
        </div>
      </div>
    </nav>
  )
}
