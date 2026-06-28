import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Swords, Check, X, ChevronRight } from 'lucide-react'
import { useNotifications } from '../context/NotificationsContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { timeAgo } from '../lib/format.js'
import Avatar from './Avatar.jsx'
import PushToggle from './PushToggle.jsx'

// Navbar bell: unread badge + a dropdown inbox. Challenge pings get inline
// Accept/Decline while they're still pending; turn/accepted pings deep-link
// straight into the match.
export default function NotificationBell() {
  const { notifications, unreadCount, markAllRead, respondChallenge } = useNotifications()
  const { t } = useLang()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null) // challenge id currently being answered
  const ref = useRef(null)

  // Opening the panel clears the unread badge.
  useEffect(() => {
    if (open) markAllRead()
  }, [open, markAllRead])

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const gl = (key) => t(`game.${key}.label`)

  const answer = async (challengeId, accept) => {
    setBusy(challengeId)
    await respondChallenge(challengeId, accept)
    setBusy(null)
    if (accept) setOpen(false)
  }

  const goMatch = (matchId) => {
    if (!matchId) return
    setOpen(false)
    navigate(`/play/${matchId}`)
  }

  const renderBody = (n) => {
    const name = n.actor?.global_name || n.actor?.username || t('app.hub.aJordanian')
    const game = n.game_type ? gl(n.game_type) : ''
    switch (n.type) {
      case 'challenge': {
        const status = n.challenge?.status
        const expired = n.challenge?.expires_at && new Date(n.challenge.expires_at) < new Date()
        const pending = status === 'pending' && !expired
        return (
          <>
            <div className="notif-text">
              <strong>{name}</strong> {t('notif.line.challenged', { game })}
            </div>
            {pending ? (
              <div className="notif-actions">
                <button
                  className="btn btn-green btn-xs"
                  disabled={busy === n.challenge.id}
                  onClick={() => answer(n.challenge.id, true)}
                >
                  {busy === n.challenge.id ? <span className="spinner sm" /> : <><Check size={13} /> {t('notif.accept')}</>}
                </button>
                <button
                  className="btn btn-line btn-xs"
                  disabled={busy === n.challenge.id}
                  onClick={() => answer(n.challenge.id, false)}
                >
                  <X size={13} /> {t('notif.decline')}
                </button>
              </div>
            ) : (
              <div className="notif-sub">
                {status === 'accepted'
                  ? t('notif.state.accepted')
                  : status === 'declined'
                    ? t('notif.state.declined')
                    : t('notif.state.expired')}
              </div>
            )}
          </>
        )
      }
      case 'challenge_accepted':
        return (
          <button className="notif-link" onClick={() => goMatch(n.match_id)}>
            <span className="notif-text">
              <strong>{name}</strong> {t('notif.line.accepted', { game })}
            </span>
            <span className="notif-cta">{t('notif.playNow')} <ChevronRight size={14} /></span>
          </button>
        )
      case 'challenge_declined':
        return (
          <div className="notif-text">
            <strong>{name}</strong> {t('notif.line.declined', { game })}
          </div>
        )
      case 'your_turn':
        return (
          <button className="notif-link" onClick={() => goMatch(n.match_id)}>
            <span className="notif-text">
              {t('notif.line.yourTurn', { game })} <strong>{name}</strong>
            </span>
            <span className="notif-cta">{t('notif.openGame')} <ChevronRight size={14} /></span>
          </button>
        )
      default:
        return null
    }
  }

  return (
    <div className="notif-wrap" ref={ref}>
      <button
        className="notif-bell"
        aria-label={t('notif.title')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label={t('notif.title')}>
          <div className="notif-head">
            <span className="notif-h-title">{t('notif.title')}</span>
          </div>
          <PushToggle />
          {notifications.length === 0 ? (
            <div className="notif-empty">
              <Swords size={22} />
              <p>{t('notif.empty')}</p>
            </div>
          ) : (
            <div className="notif-list">
              {notifications.map((n) => (
                <div className={`notif-item${n.read_at ? '' : ' unread'}`} key={n.id}>
                  <Avatar profile={n.actor} />
                  <div className="notif-body">
                    {renderBody(n)}
                    <div className="notif-ago">{timeAgo(n.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
