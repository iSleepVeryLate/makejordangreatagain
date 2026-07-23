import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ghost, Plus, LogIn, Clock, ListChecks, Timer } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useToast } from '../context/ToastContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { friendlyRpcError } from '../lib/rpcErrors.js'
import AppNav from '../components/AppNav.jsx'

// المندس — create/join landing (mirrors DrawHome).

const DISCUSSION_OPTS = [30, 45, 60]
const TASK_OPTS = [3, 4, 5]
const COOLDOWN_OPTS = [20, 25, 35]

export default function MundassHome() {
  const navigate = useNavigate()
  const toast = useToast()
  const { t, dir } = useLang()

  const [discussion, setDiscussion] = useState(45)
  const [tasks, setTasks] = useState(4)
  const [cooldown, setCooldown] = useState(25)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('mundass_create_room', {
      p_discussion_seconds: discussion,
      p_voting_seconds: 30,
      p_kill_cooldown_seconds: cooldown,
      p_tasks_per_player: tasks,
    })
    setBusy(false)
    if (error) return toast(friendlyRpcError(error, t), 'error')
    if (data?.id) navigate(`/mundass/${data.id}`)
  }

  const join = async (e) => {
    e.preventDefault()
    const c = code.trim()
    if (!c) return
    setBusy(true)
    const { data, error } = await supabase.rpc('mundass_join', { p_code: c })
    setBusy(false)
    if (error) return toast(error.message || t('mundass.err.join'), 'error')
    if (data?.id) navigate(`/mundass/${data.id}`)
  }

  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap" dir={dir}>
          <div className="section-head">
            <h1><Ghost size={26} style={{ verticalAlign: '-4px', marginInlineEnd: 10 }} />{t('mundass.title')}</h1>
            <p>{t('mundass.tagline')}</p>
          </div>

          <div className="draw-home-grid">
            <div className="panel draw-home-card">
              <h4><Plus size={15} /> {t('mundass.createRoom')}</h4>

              <div className="draw-field">
                <label><Clock size={13} /> {t('mundass.discussionTime')}</label>
                <div className="draw-seg">
                  {DISCUSSION_OPTS.map((s) => (
                    <button key={s} className={discussion === s ? 'on' : ''} onClick={() => setDiscussion(s)}>{s}s</button>
                  ))}
                </div>
              </div>

              <div className="draw-field">
                <label><ListChecks size={13} /> {t('mundass.tasksEach')}</label>
                <div className="draw-seg">
                  {TASK_OPTS.map((n) => (
                    <button key={n} className={tasks === n ? 'on' : ''} onClick={() => setTasks(n)}>{n}</button>
                  ))}
                </div>
              </div>

              <div className="draw-field">
                <label><Timer size={13} /> {t('mundass.killCooldown')}</label>
                <div className="draw-seg">
                  {COOLDOWN_OPTS.map((s) => (
                    <button key={s} className={cooldown === s ? 'on' : ''} onClick={() => setCooldown(s)}>{s}s</button>
                  ))}
                </div>
              </div>

              <button className="btn btn-green btn-block" onClick={create} disabled={busy}>
                {busy ? <span className="spinner sm" /> : <><Plus size={16} /> {t('mundass.createBtn')}</>}
              </button>
              <p className="draw-home-note">{t('mundass.createNote')}</p>
            </div>

            <div className="panel draw-home-card">
              <h4><LogIn size={15} /> {t('mundass.joinRoom')}</h4>
              <p className="draw-home-note" style={{ marginTop: 0 }}>{t('mundass.joinNote')}</p>
              <form onSubmit={join} className="draw-join-form">
                <input
                  className="draw-code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={t('mundass.codePlaceholder')}
                  maxLength={6}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                <button className="btn btn-line btn-block" type="submit" disabled={busy || !code.trim()}>
                  <LogIn size={16} /> {t('mundass.joinBtn')}
                </button>
              </form>
            </div>
          </div>

          <div className="draw-howto">
            <span className="glabel">{t('mundass.howTitle')}</span>
            <ol>
              <li>{t('mundass.how1')}</li>
              <li>{t('mundass.how2')}</li>
              <li>{t('mundass.how3')}</li>
              <li>{t('mundass.how4')}</li>
            </ol>
          </div>
        </div>
      </main>
    </>
  )
}
