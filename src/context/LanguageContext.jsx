import { createContext, useCallback, useContext, useState } from 'react'
import { STRINGS } from '../i18n/strings.js'

// Language state for the public resource area. Persisted in localStorage and
// defaulted from the browser locale. `dir` is applied to the resource wrapper
// (not <html>) so only the translated pages flip to RTL — the English landing
// and game pages are unaffected.
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

  const t = useCallback(
    (key) => {
      const entry = STRINGS[key]
      if (!entry) return key
      return entry[lang] ?? entry.en ?? key
    },
    [lang],
  )

  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  return (
    <LanguageContext.Provider value={{ lang, dir, setLang, t }}>{children}</LanguageContext.Provider>
  )
}

export function useLang() {
  return useContext(LanguageContext)
}
