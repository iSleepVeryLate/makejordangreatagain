import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useToast } from '../context/ToastContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { timeAgo } from '../lib/format.js'
import AppNav from '../components/AppNav.jsx'

// Lightweight ops dashboard: live/stale room counts per system + a recent-events
// feed with one-click force-close. Read-mostly: a 15s poll (no realtime) keeps
// chatter near zero. All data comes from room_admin_stats() (migration 0016),
// which is admin-gated server-side; force-close goes through admin_force_close().
const SYSTEMS = ['match', 'draw', 'monopoly']

const statRow = { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14 }

export default function AdminRooms() {
  const toast = useToast()
  const { t } = useLang()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(null) // `${system}:${room}` mid-close

  const fetchStats = useCallback(() => {
    supabase.rpc('room_admin_stats').then(
      ({ data, error }) => {
        if (!error && data) setStats(data)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [])

  useEffect(() => {
    fetchStats()
    const iv = setInterval(() => { if (!document.hidden) fetchStats() }, 15000)
    const onVis = () => { if (!document.hidden) fetchStats() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  }, [fetchStats])

  const forceClose = async (system, room) => {
    if (!system || !room) return
    if (!confirm(t('admin.forceCloseConfirm'))) return
    const key = `${system}:${room}`
    setClosing(key)
    const { error } = await supabase.rpc('admin_force_close', { p_system: system, p_room: room })
    setClosing(null)
    if (error) { toast(error.message, 'error'); return }
    toast(t('admin.closed'), 'success')
    fetchStats()
  }

  const events = stats?.events || []

  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap">
          <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1>{t('admin.title')}</h1>
              <p>{t('admin.subtitle')}</p>
            </div>
            <button className="btn btn-line btn-sm" onClick={fetchStats}>
              <RefreshCw size={15} /> {t('admin.refresh')}
            </button>
          </div>

          {loading && !stats ? (
            <div className="page-loader"><div className="spinner" /></div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
                {SYSTEMS.map((sys) => {
                  const s = stats?.[sys] || {}
                  const a = sys === 'match' ? s.waiting : s.lobby
                  const b = sys === 'match' ? s.active : s.playing
                  const aLabel = sys === 'match' ? t('admin.waiting') : t('admin.lobby')
                  const bLabel = sys === 'match' ? t('admin.active') : t('admin.playing')
                  const stale = s.stale || 0
                  return (
                    <div className="panel" key={sys}>
                      <h4>{t(`admin.system.${sys}`)}</h4>
                      <div style={statRow}><span className="muted">{aLabel}</span><strong>{a ?? 0}</strong></div>
                      <div style={statRow}><span className="muted">{bLabel}</span><strong>{b ?? 0}</strong></div>
                      <div style={statRow}>
                        <span className="muted">{t('admin.stale')}</span>
                        {stale > 0 ? <strong className="err-text">{stale}</strong> : <strong>0</strong>}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="glabel">{t('admin.events')}</div>
              {events.length === 0 ? (
                <div className="empty-state">{t('admin.empty')}</div>
              ) : (
                <div className="rooms">
                  {events.map((e) => {
                    const canClose = SYSTEMS.includes(e.system) && !!e.room_ref
                    const key = `${e.system}:${e.room_ref}`
                    return (
                      <div className="room-row" key={e.id}>
                        <div className="who">
                          <div>
                            <div className="room-name">
                              {e.event_type}
                              <span className="tag" style={{ marginInlineStart: 8 }}>{e.system}</span>
                            </div>
                            <div className="meta">
                              {e.room_ref ? `${String(e.room_ref).slice(0, 8)}…` : '—'} · {timeAgo(e.created_at)}
                            </div>
                          </div>
                        </div>
                        {canClose && (
                          <button
                            className="btn btn-line btn-sm"
                            disabled={closing === key}
                            onClick={() => forceClose(e.system, e.room_ref)}
                          >
                            {closing === key ? <span className="spinner sm" /> : t('admin.forceClose')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  )
}
