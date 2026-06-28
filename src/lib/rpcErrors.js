// Turn a Postgres / RPC error into a friendly, localized message.
//
// The create RPCs raise machine-parseable codes (migration 0014):
//   * 'cap:<n>'      — you already hold <n> open rooms (concurrent cap hit)
//   * 'cooldown:<n>' — creating too fast; retry in <n> seconds
// We translate those into the user's language; anything else falls back to the
// raw message (already human-ish, e.g. "Room not found") or a generic string.
export function friendlyRpcError(error, t) {
  const raw =
    (error && (error.message || error.error_description || error.details || error.hint)) || ''

  const cap = /cap:(\d+)/i.exec(raw)
  if (cap) return t('app.err.roomCap', { n: cap[1] })

  const cooldown = /cooldown:(\d+)/i.exec(raw)
  if (cooldown) return t('app.err.cooldown', { n: cooldown[1] })

  return raw || t('app.common.somethingWrong')
}
