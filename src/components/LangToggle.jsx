import { useLang } from '../context/LanguageContext.jsx'

// Language switch for the resource area. The label shows the language you'd
// switch TO ("العربية" while in English, "English" while in Arabic).
export default function LangToggle() {
  const { lang, setLang, t } = useLang()
  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
      aria-label={lang === 'en' ? 'التبديل إلى العربية' : 'Switch to English'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
      </svg>
      <span>{t('lang.switch')}</span>
    </button>
  )
}
