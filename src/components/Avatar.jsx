import { useState, useEffect } from 'react'

const SIZE_CLASS = { sm: '', md: 'md', lg: 'lg' }

export default function Avatar({ profile, size = 'sm', className = '' }) {
  const name = profile?.global_name || profile?.username || '?'
  const initials = name.trim().slice(0, 2).toUpperCase()
  const cls = ['avatar', SIZE_CLASS[size] || '', className].filter(Boolean).join(' ')

  const [broken, setBroken] = useState(false)
  // reset the error state if the avatar url changes
  useEffect(() => setBroken(false), [profile?.avatar_url])

  if (profile?.avatar_url && !broken) {
    return (
      <img
        className={cls}
        src={profile.avatar_url}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    )
  }
  return <span className={cls}>{initials}</span>
}
