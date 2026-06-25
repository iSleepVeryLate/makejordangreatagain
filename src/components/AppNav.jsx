import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import BrandMark from './BrandMark.jsx'
import Avatar from './Avatar.jsx'

export default function AppNav() {
  const { profile, signOut } = useAuth()
  return (
    <nav className="appnav">
      <div className="app-wrap appnav-inner">
        <BrandMark to="/play" />
        <div className="appnav-right">
          <div className="appnav-links">
            <NavLink to="/play">Games</NavLink>
            <NavLink to="/leaderboard">Leaderboard</NavLink>
            <NavLink to="/explore">Explore</NavLink>
          </div>
          {profile && (
            <NavLink className="user-chip" to={`/profile/${profile.id}`}>
              <Avatar profile={profile} />
              <span className="uname">{profile.global_name || profile.username}</span>
            </NavLink>
          )}
          <button className="btn btn-line btn-sm" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </nav>
  )
}
