import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Landmark, Plus, LogIn, Clock, Coins, Users } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useToast } from '../context/ToastContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { friendlyRpcError } from '../lib/rpcErrors.js'
import AppNav from '../components/AppNav.jsx'

const TIME_OPTS = [45, 60, 90]
const CASH_OPTS = [1500, 2500]
const PLAYER_OPTS = [4, 6, 8]

export default function MonopolyHome() {
  const navigate = useNavigate()
  const toast = useToast()
  const { t, dir } = useLang()

  const [seconds, setSeconds] = useState(60)
  const [cash, setCash] = useState(1500)
  const [maxPlayers, setMaxPlayers] = useState(8)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('monopoly_create_room', {
      p_turn_seconds: seconds,
      p_start_cash: cash,
      p_max_players: maxPlayers,
    })
    setBusy(false)
    if (error) return toast(friendlyRpcError(error, t), 'error')
    if (data?.id) navigate(`/monopoly/${data.id}`)
  }

  const join = async (e) => {
    e.preventDefault()
    const c = code.trim()
    if (!c) return
    setBusy(true)
    const { data, error } = await supabase.rpc('monopoly_join', { p_code: c })
    setBusy(false)
    if (error) return toast(error.message || t('mono.err.join'), 'error')
    if (data?.id) navigate(`/monopoly/${data.id}`)
  }

  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap" dir={dir}>
          <div className="section-head">
            <h1><Landmark size={26} style={{ verticalAlign: '-4px', marginInlineEnd: 10 }} />{t('mono.title')}</h1>
            <p>{t('mono.tagline')}</p>
          </div>

          <div className="draw-home-grid">
            <div className="panel draw-home-card">
              <h4><Plus size={15} /> {t('mono.createRoom')}</h4>

              <div className="draw-field">
                <label><Clock size={13} /> {t('mono.turnTime')}</label>
                <div className="draw-seg">
                  {TIME_OPTS.map((s) => (
                    <button key={s} className={seconds === s ? 'on' : ''} onClick={() => setSeconds(s)}>{s}s</button>
                  ))}
                </div>
              </div>

              <div className="draw-field">
                <label><Coins size={13} /> {t('mono.startCash')}</label>
                <div className="draw-seg">
                  {CASH_OPTS.map((c) => (
                    <button key={c} className={cash === c ? 'on' : ''} onClick={() => setCash(c)}>{c}</button>
                  ))}
                </div>
              </div>

              <div className="draw-field">
                <label><Users size={13} /> {t('mono.maxPlayers')}</label>
                <div className="draw-seg">
                  {PLAYER_OPTS.map((p) => (
                    <button key={p} className={maxPlayers === p ? 'on' : ''} onClick={() => setMaxPlayers(p)}>{p}</button>
                  ))}
                </div>
              </div>

              <button className="btn btn-green btn-block" onClick={create} disabled={busy}>
                {busy ? <span className="spinner sm" /> : <><Plus size={16} /> {t('mono.createBtn')}</>}
              </button>
              <p className="draw-home-note">{t('mono.createNote')}</p>
            </div>

            <div className="panel draw-home-card">
              <h4><LogIn size={15} /> {t('mono.joinRoom')}</h4>
              <p className="draw-home-note" style={{ marginTop: 0 }}>{t('mono.joinNote')}</p>
              <form onSubmit={join} className="draw-join-form">
                <input
                  className="draw-code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={t('mono.codePlaceholder')}
                  maxLength={5}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                <button className="btn btn-line btn-block" type="submit" disabled={busy || !code.trim()}>
                  <LogIn size={16} /> {t('mono.joinBtn')}
                </button>
              </form>
            </div>
          </div>

          <div className="draw-howto">
            <span className="glabel">{t('mono.howTitle')}</span>
            <ol>
              <li>{t('mono.how1')}</li>
              <li>{t('mono.how2')}</li>
              <li>{t('mono.how3')}</li>
            </ol>
          </div>
        </div>
      </main>
    </>
  )
}
