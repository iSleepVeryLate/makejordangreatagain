import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Palette, Plus, LogIn, Users, Clock, Hash } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useToast } from '../context/ToastContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { friendlyRpcError } from '../lib/rpcErrors.js'
import AppNav from '../components/AppNav.jsx'

const ROUND_OPTS = [2, 3, 4]
const TIME_OPTS = [60, 75, 90]

export default function DrawHome() {
  const navigate = useNavigate()
  const toast = useToast()
  const { t, lang: uiLang, dir } = useLang()

  const [lang, setLang] = useState(uiLang === 'ar' ? 'ar' : 'en')
  const [rounds, setRounds] = useState(3)
  const [seconds, setSeconds] = useState(75)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('draw_create_room', {
      p_lang: lang,
      p_total_rounds: rounds,
      p_round_seconds: seconds,
    })
    setBusy(false)
    if (error) return toast(friendlyRpcError(error, t), 'error')
    if (data?.id) navigate(`/draw/${data.id}`)
  }

  const join = async (e) => {
    e.preventDefault()
    const c = code.trim()
    if (!c) return
    setBusy(true)
    const { data, error } = await supabase.rpc('draw_join', { p_code: c })
    setBusy(false)
    if (error) return toast(error.message || t('draw.err.join'), 'error')
    if (data?.id) navigate(`/draw/${data.id}`)
  }

  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap" dir={dir}>
          <div className="section-head">
            <h1><Palette size={26} style={{ verticalAlign: '-4px', marginInlineEnd: 10 }} />{t('draw.title')}</h1>
            <p>{t('draw.tagline')}</p>
          </div>

          <div className="draw-home-grid">
            <div className="panel draw-home-card">
              <h4><Plus size={15} /> {t('draw.createRoom')}</h4>

              <div className="draw-field">
                <label><Hash size={13} /> {t('draw.language')}</label>
                <div className="draw-seg">
                  <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
                  <button className={lang === 'ar' ? 'on' : ''} onClick={() => setLang('ar')}>العربية</button>
                </div>
              </div>

              <div className="draw-field">
                <label><Users size={13} /> {t('draw.rounds')}</label>
                <div className="draw-seg">
                  {ROUND_OPTS.map((r) => (
                    <button key={r} className={rounds === r ? 'on' : ''} onClick={() => setRounds(r)}>{r}</button>
                  ))}
                </div>
              </div>

              <div className="draw-field">
                <label><Clock size={13} /> {t('draw.drawTime')}</label>
                <div className="draw-seg">
                  {TIME_OPTS.map((s) => (
                    <button key={s} className={seconds === s ? 'on' : ''} onClick={() => setSeconds(s)}>{s}s</button>
                  ))}
                </div>
              </div>

              <button className="btn btn-green btn-block" onClick={create} disabled={busy}>
                {busy ? <span className="spinner sm" /> : <><Plus size={16} /> {t('draw.createBtn')}</>}
              </button>
              <p className="draw-home-note">{t('draw.createNote')}</p>
            </div>

            <div className="panel draw-home-card">
              <h4><LogIn size={15} /> {t('draw.joinRoom')}</h4>
              <p className="draw-home-note" style={{ marginTop: 0 }}>{t('draw.joinNote')}</p>
              <form onSubmit={join} className="draw-join-form">
                <input
                  className="draw-code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={t('draw.codePlaceholder')}
                  maxLength={6}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                <button className="btn btn-line btn-block" type="submit" disabled={busy || !code.trim()}>
                  <LogIn size={16} /> {t('draw.joinBtn')}
                </button>
              </form>
            </div>
          </div>

          <div className="draw-howto">
            <span className="glabel">{t('draw.howTitle')}</span>
            <ol>
              <li>{t('draw.how1')}</li>
              <li>{t('draw.how2')}</li>
              <li>{t('draw.how3')}</li>
            </ol>
          </div>
        </div>
      </main>
    </>
  )
}
