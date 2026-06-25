import { useEffect, useRef, useState } from 'react'
import { Crown, Pencil, Check, Send } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import Avatar from '../components/Avatar.jsx'

// Chat + guessing + the live scoreboard. A guess goes to the server (draw_guess),
// which alone knows the word. On a correct result we broadcast a SYSTEM line ("X
// guessed it!") — never the raw text, so spectators can't read the answer out of
// chat. A wrong guess is just broadcast as an ordinary chat message.
export default function DrawGuessPanel({ room, players, myId, myName, sendBroadcast, onMessage, t }) {
  const [log, setLog] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef(null)
  const keyRef = useRef(0)

  const push = (entry) => setLog((l) => [...l.slice(-80), { k: keyRef.current++, ...entry }])

  useEffect(() => {
    const off = onMessage((p) => {
      if (!p || p.t !== 'chat') return
      push({ kind: p.kind, name: p.name, text: p.text })
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMessage])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const me = players.find((p) => p.profile_id === myId)
  const iAmDrawer = room.drawer === myId
  const iGuessed = !!me?.guessed_at
  const canGuess = room.phase === 'drawing' && !iAmDrawer && !iGuessed

  const submit = async (e) => {
    e.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    setText('')
    if (!canGuess) {
      // lobby / reveal / between-rounds: plain chat
      push({ kind: 'msg', name: myName, text: value })
      sendBroadcast({ t: 'chat', kind: 'msg', name: myName, text: value })
      return
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('draw_guess', { p_room: room.id, p_text: value })
    setBusy(false)
    if (error) {
      push({ kind: 'msg', name: myName, text: value })
      sendBroadcast({ t: 'chat', kind: 'msg', name: myName, text: value })
      return
    }
    if (data?.correct) {
      push({ kind: 'correct', name: myName })
      sendBroadcast({ t: 'chat', kind: 'correct', name: myName })
    } else {
      push({ kind: 'msg', name: myName, text: value })
      sendBroadcast({ t: 'chat', kind: 'msg', name: myName, text: value })
    }
  }

  const ranked = [...players].sort((a, b) => b.score - a.score)

  return (
    <div className="draw-side">
      <div className="panel draw-scores">
        <h4>{t('draw.players')} · {players.length}</h4>
        <div className="rail-list">
          {ranked.map((p, i) => {
            const prof = p.profile || {}
            const isDrawer = room.drawer === p.profile_id
            return (
              <div className={`draw-score-row${p.profile_id === myId ? ' me' : ''}`} key={p.profile_id}>
                <span className="draw-rank">{i + 1}</span>
                <Avatar profile={prof} />
                <span className="draw-pname">
                  {prof.global_name || prof.username || 'player'}
                  {room.host === p.profile_id && <Crown size={12} className="draw-host-ic" />}
                </span>
                {isDrawer ? (
                  <Pencil size={14} className="draw-draw-ic" />
                ) : p.guessed_at ? (
                  <Check size={15} className="draw-ok-ic" />
                ) : null}
                <span className="draw-score-num">{p.score}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="panel draw-chat">
        <h4>{t('draw.chat')}</h4>
        <div className="draw-chat-log" ref={listRef}>
          {log.length === 0 && <div className="rail-empty">{t('draw.chatHint')}</div>}
          {log.map((m) => (
            <div className={`draw-chat-line ${m.kind}`} key={m.k}>
              {m.kind === 'correct' ? (
                <span><b>{m.name}</b> {t('draw.guessedIt')}</span>
              ) : (
                <span><b>{m.name}:</b> {m.text}</span>
              )}
            </div>
          ))}
        </div>
        <form className="draw-chat-form" onSubmit={submit}>
          <input
            className="draw-chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              iAmDrawer
                ? t('draw.youDraw')
                : iGuessed
                  ? t('draw.youGotIt')
                  : t('draw.guessPlaceholder')
            }
            maxLength={80}
            disabled={busy}
          />
          <button className="btn btn-green btn-sm" type="submit" disabled={busy || !text.trim()}>
            <Send size={15} />
          </button>
        </form>
      </div>
    </div>
  )
}
