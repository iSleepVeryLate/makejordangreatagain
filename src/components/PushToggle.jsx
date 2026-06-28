import { BellRing, BellOff } from 'lucide-react'
import { usePushNotifications } from '../hooks/usePushNotifications.js'
import { useLang } from '../context/LanguageContext.jsx'
import { useToast } from '../context/ToastContext.jsx'

// A single row at the top of the notification panel: lets the user opt this
// device into "your turn" / challenge push notifications. Renders nothing when
// push isn't available (unsupported browser, dev build, or signed out).
export default function PushToggle() {
  const { available, permission, subscribed, busy, enable, disable } = usePushNotifications()
  const { t } = useLang()
  const toast = useToast()

  if (!available) return null

  const onEnable = async () => {
    const res = await enable()
    if (res === true) toast(t('push.enabled'), 'success')
    else if (res === 'permission_denied') toast(t('push.denied'), 'error')
    else toast(t('push.error'), 'error')
  }

  const onDisable = async () => {
    await disable()
    toast(t('push.disabled'), 'info')
  }

  // Blocked at the browser level — a button can't fix that, so point them to settings.
  if (permission === 'denied' && !subscribed) {
    return (
      <div className="push-row">
        <BellOff className="push-ic" size={17} />
        <span className="push-txt push-hint">{t('push.blockedHint')}</span>
      </div>
    )
  }

  if (subscribed) {
    return (
      <div className="push-row">
        <BellRing className="push-ic" size={17} />
        <span className="push-txt">{t('push.on')}</span>
        <button className="btn btn-line btn-xs" disabled={busy} onClick={onDisable}>
          {busy ? <span className="spinner sm" /> : t('push.turnOff')}
        </button>
      </div>
    )
  }

  return (
    <div className="push-row">
      <BellRing className="push-ic" size={17} />
      <span className="push-txt">{t('push.prompt')}</span>
      <button className="btn btn-green btn-xs" disabled={busy} onClick={onEnable}>
        {busy ? <span className="spinner sm" /> : t('push.enable')}
      </button>
    </div>
  )
}
