import { useEffect, useRef, useState } from 'react'
import { Swords } from 'lucide-react'
import { useNotifications } from '../context/NotificationsContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { GAMES } from '../games/config.js'
import GameIcon from './GameIcon.jsx'

// Challenge a specific player. Opens a small game picker (the 5 matches-based
// games), fires create_challenge, and closes. `variant="icon"` is the compact
// swords button used in the lobby's online rail; `variant="full"` is the wide
// button on a profile page.
export default function ChallengeButton({ toId, variant = 'icon' }) {
  const { createChallenge } = useNotifications()
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = async (gameKey) => {
    setBusy(true)
    const ok = await createChallenge(toId, gameKey)
    setBusy(false)
    if (ok) setOpen(false)
  }

  return (
    <div className="chal-wrap" ref={ref}>
      {variant === 'full' ? (
        <button className="btn btn-green" disabled={busy} onClick={() => setOpen((v) => !v)}>
          <Swords size={16} /> {t('notif.challenge')}
        </button>
      ) : (
        <button
          className="chal-icon"
          disabled={busy}
          aria-label={t('notif.challenge')}
          title={t('notif.challenge')}
          onClick={() => setOpen((v) => !v)}
        >
          <Swords size={15} />
        </button>
      )}

      {open && (
        <div className={`chal-menu ${variant}`} role="menu">
          <div className="chal-menu-h">{t('notif.pickGame')}</div>
          {GAMES.map((g) => (
            <button key={g.key} className="chal-opt" role="menuitem" disabled={busy} onClick={() => pick(g.key)}>
              <span className={`gicon sm ${g.tint}`}>
                <GameIcon game={g.key} size={15} />
              </span>
              <span>{t(`game.${g.key}.label`)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
