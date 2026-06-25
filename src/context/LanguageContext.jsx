import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { STRINGS } from '../i18n/strings.js'

// App-wide language state. Persisted in localStorage and defaulted from the
// browser locale. The whole app — landing, resources, game hub, and every
// game — is fully bilingual, so `dir`/`lang` are applied to <html> and the
// entire UI flips to RTL when Arabic is chosen.
const LanguageContext = createContext({ lang: 'en', dir: 'ltr', setLang: () => {}, t: (k) => k })

function initialLang() {
  try {
    const saved = localStorage.getItem('jst-lang')
    if (saved === 'en' || saved === 'ar') return saved
  } catch {
    /* localStorage unavailable */
  }
  if (typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('ar')) {
    return 'ar'
  }
  return 'en'
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initialLang)

  const setLang = useCallback((next) => {
    setLangState(next)
    try {
      localStorage.setItem('jst-lang', next)
    } catch {
      /* ignore */
    }
  }, [])

  // t('key') returns the translated string; t('key', { n: 3 }) also fills any
  // {placeholder} tokens, e.g. '{n} online now' → '3 online now'.
  const t = useCallback(
    (key, vars) => {
      const entry = STRINGS[key]
      let str = entry ? entry[lang] ?? entry.en ?? key : key
      if (vars) {
        for (const name in vars) str = str.replaceAll(`{${name}}`, String(vars[name]))
      }
      return str
    },
    [lang],
  )

  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  // Reflect the chosen language onto <html> so the whole app flips direction and
  // picks up the Arabic font — not just the resource pages.
  useEffect(() => {
    const el = document.documentElement
    el.setAttribute('lang', lang)
    el.setAttribute('dir', dir)
  }, [lang, dir])

  return (
    <LanguageContext.Provider value={{ lang, dir, setLang, t }}>{children}</LanguageContext.Provider>
  )
}

export function useLang() {
  return useContext(LanguageContext)
}
