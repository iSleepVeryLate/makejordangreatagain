import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { sound } from '../lib/sound.js'

// Thin React binding over the WebAudio sound singleton. `muted` is read through
// useSyncExternalStore so a toggle anywhere updates every speaker icon, and the
// autoplay-unlock listener is armed once on mount.
export function useSound() {
  const muted = useSyncExternalStore(sound.subscribe, sound.getMuted, sound.getMuted)
  useEffect(() => { sound.installUnlock() }, [])
  const play = useCallback((name) => sound.play(name), [])
  const toggleMute = useCallback(() => sound.toggleMute(), [])
  return { play, muted, toggleMute }
}
