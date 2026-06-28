// Browser-side Web Push helpers. Pairs with public/sw.js (the `push` handler)
// and the save/delete_push_subscription RPCs (migration 0012).
//
// Push only works against a registered service worker, and the SW is registered
// in production builds only (see registerSW.js) — so the whole feature is gated
// to PROD. In dev there is simply nothing to subscribe to, which is fine: push
// is a deployed-site concern, not a local-dev one.
import { supabase } from './supabaseClient.js'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

// True only when the app was built with a VAPID public key AND we're a prod
// build (the only place the service worker actually registers).
export const PUSH_CONFIGURED = !!VAPID_PUBLIC_KEY && import.meta.env.PROD

// Does this browser have the APIs at all? (Safari/iOS gained these late; older
// browsers and some in-app webviews still lack them.)
export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// VAPID public key is base64url; PushManager wants a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Current state without prompting the user or hanging if no SW is registered.
export async function getPushState() {
  if (!isPushSupported()) return { supported: false, permission: 'denied', subscribed: false }
  let subscribed = false
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg) subscribed = !!(await reg.pushManager.getSubscription())
  } catch {
    /* ignore — treat as not subscribed */
  }
  return { supported: true, permission: Notification.permission, subscribed }
}

// Ask for permission, subscribe this device, and register it server-side.
// Throws a coded Error ('permission_denied' | 'push_unsupported' | ...) so the
// caller can show the right message.
export async function subscribeToPush(lang = 'en') {
  if (!PUSH_CONFIGURED) throw new Error('push_not_configured')
  if (!isPushSupported()) throw new Error('push_unsupported')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('permission_denied')

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const j = sub.toJSON() // { endpoint, keys: { p256dh, auth } } — already base64url
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: j.endpoint,
    p_p256dh: j.keys?.p256dh,
    p_auth: j.keys?.auth,
    p_lang: lang,
    p_ua: navigator.userAgent ? navigator.userAgent.slice(0, 300) : null,
  })
  if (error) throw error
  return true
}

// Turn this device off: drop it server-side, then unsubscribe locally.
export async function unsubscribeFromPush() {
  if (!isPushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const j = sub.toJSON()
  if (j.endpoint) await supabase.rpc('delete_push_subscription', { p_endpoint: j.endpoint })
  await sub.unsubscribe().catch(() => {})
}
