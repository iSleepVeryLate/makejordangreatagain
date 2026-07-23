import { useEffect, useRef, useState } from 'react'
import Avatar from '../../components/Avatar.jsx'
import { COLORS } from './map.js'

// اجتماع الحارة — the full-screen meeting: discussion (chat), voting, reveal.
// Votes go through onVote → the Edge Function; WHO voted is public
// (meeting.voted) but never for whom until the reveal tally. Chat rides the
// ephemeral broadcast bus; ghost messages are only shown to ghosts.

function Countdown({ endsAt, serverNow }) {
  const [, force] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 500)
    return () => clearInterval(iv)
  }, [])
  const left = Math.max(0, Math.ceil((endsAt - serverNow()) / 1000))
  return <span className="mun-meet-clock">{left}s</span>
}

export default function MeetingOverlay({
  state, players, myId, iAmGhost, serverNow, onVote, chat, onSendChat, t, lang, dir,
}) {
  const m = state.meeting
  const [text, setText] = useState('')
  const logRef = useRef(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat, m?.stage])

  if (!m) return null
  const alive = state.alive || {}
  const nameOf = (uid) => {
    const p = players.find((pp) => pp.profile_id === uid)
    return p?.profile?.global_name || p?.profile?.username || '؟'
  }
  const iVoted = m.voted?.includes(myId)
  const canVote = m.stage === 'voting' && !iAmGhost && !iVoted
  const canChat = m.stage !== 'reveal' && (!iAmGhost || true) // ghosts chat too (ghost-only visibility)

  const send = (e) => {
    e.preventDefault()
    const msg = text.trim()
    if (!msg) return
    onSendChat(msg)
    setText('')
  }

  const visibleChat = chat.filter((c) => !c.ghost || iAmGhost)
  const result = m.result

  return (
    <div className="mun-meet-backdrop" dir={dir}>
      <div className="mun-meet">
        <div className="mun-meet-head">
          <div className="mun-meet-title">
            {m.kind === 'body' ? '🚨 ' : '🏺 '}
            {m.kind === 'body'
              ? t('mundass.meetBody', { name: nameOf(m.caller), victim: nameOf(m.victim) })
              : t('mundass.meetEmergency', { name: nameOf(m.caller) })}
          </div>
          {m.stage !== 'reveal' && (
            <div className="mun-meet-stage">
              {m.stage === 'discussion' ? t('mundass.discussion') : t('mundass.voting')}
              {' · '}
              <Countdown endsAt={m.endsAt} serverNow={serverNow} />
            </div>
          )}
        </div>

        {m.stage === 'reveal' && result ? (
          <div className="mun-meet-reveal">
            {result.ejected ? (
              <>
                <div className="mun-meet-ejected">
                  {t('mundass.ejected', { name: nameOf(result.ejected) })}
                </div>
                <div className={`mun-meet-verdict ${result.wasMundass ? 'was' : 'not'}`}>
                  {result.wasMundass ? t('mundass.wasMundass') : t('mundass.notMundass')}
                </div>
              </>
            ) : (
              <div className="mun-meet-ejected">{t('mundass.noEjection')}</div>
            )}
            <div className="mun-meet-tally">
              {Object.entries(result.tally || {})
                .sort((a, b) => b[1] - a[1])
                .map(([target, n]) => (
                  <div key={target} className="mun-meet-tally-row">
                    <span>{target === 'skip' ? t('mundass.skip') : nameOf(target)}</span>
                    <span className="mun-meet-tally-bar">
                      {Array.from({ length: n }, (_, i) => <i key={i} />)}
                    </span>
                    <b>{n}</b>
                  </div>
                ))}
              {result.abstained > 0 && (
                <div className="mun-meet-tally-row dim">
                  <span>{t('mundass.abstained')}</span><span /><b>{result.abstained}</b>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mun-meet-grid">
            {players.map((p) => {
              const uid = p.profile_id
              const isAlive = alive[uid] !== false
              const voted = m.voted?.includes(uid)
              return (
                <div key={uid} className={`mun-meet-card ${isAlive ? '' : 'dead'}`}>
                  <span className="mun-meet-chip" style={{ background: COLORS[(p.color || 0) % COLORS.length] }} />
                  <Avatar profile={p.profile} size="sm" />
                  <span className="mun-meet-name">
                    {nameOf(uid)}
                    {uid === m.caller && <span className="mun-meet-callerTag"> 🏺</span>}
                  </span>
                  {!isAlive && <span className="mun-meet-deadTag">☠</span>}
                  {isAlive && voted && <span className="mun-meet-votedTag">✓</span>}
                  {canVote && isAlive && uid !== myId && (
                    <button className="mun-meet-votebtn" onClick={() => onVote(uid)}>
                      {t('mundass.vote')}
                    </button>
                  )}
                </div>
              )
            })}
            {canVote && (
              <button className="mun-meet-skip" onClick={() => onVote('skip')}>
                {t('mundass.skipVote')}
              </button>
            )}
            {m.stage === 'voting' && iVoted && (
              <div className="mun-meet-waiting">{t('mundass.voteCast')}</div>
            )}
          </div>
        )}

        {m.stage !== 'reveal' && (
          <div className="mun-meet-chat">
            <div className="mun-meet-log" ref={logRef}>
              {visibleChat.map((c, i) => (
                <div key={i} className={`mun-meet-msg ${c.ghost ? 'ghost' : ''}`}>
                  <b>{c.name}:</b> {c.text}
                </div>
              ))}
              {visibleChat.length === 0 && (
                <div className="mun-meet-msg dim">{t('mundass.chatHint')}</div>
              )}
            </div>
            {canChat && (
              <form className="mun-meet-form" onSubmit={send}>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={140}
                  placeholder={iAmGhost ? t('mundass.ghostChat') : t('mundass.chatPlaceholder')}
                  dir={dir}
                />
                <button type="submit">{lang === 'ar' ? 'إرسال' : 'Send'}</button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
