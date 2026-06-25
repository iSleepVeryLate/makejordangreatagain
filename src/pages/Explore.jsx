import { Link } from 'react-router-dom'
import ResourceLayout from '../components/ResourceLayout.jsx'
import Seo from '../components/Seo.jsx'
import { useResource } from '../hooks/useResource.js'
import { useLang } from '../context/LanguageContext.jsx'

const SECTIONS = [
  { to: '/tourism', tint: 'a', emoji: '🏛️', titleKey: 'explore.tourism.title', descKey: 'explore.tourism.desc' },
  { to: '/services', tint: 'g', emoji: '🏢', titleKey: 'explore.services.title', descKey: 'explore.services.desc' },
  { to: '/emergency', tint: 'r', emoji: '🚨', titleKey: 'explore.emergency.title', descKey: 'explore.emergency.desc' },
]

export default function Explore() {
  const { rows: numbers } = useResource('emergency_numbers')
  const { t, lang } = useLang()
  const L = (en, ar) => (lang === 'ar' && ar ? ar : en)
  const quick = numbers.slice(0, 4)

  return (
    <ResourceLayout>
      <Seo
        title="Explore Jordan — Resources for Residents"
        description="A free directory for everyone in Jordan: tourism spots, government offices and services, and emergency numbers. No account needed."
        path="/explore"
      />
      <div className="res-hero">
        <span className="res-eyebrow">{t('explore.eyebrow')}</span>
        <h1>{t('explore.title')}</h1>
        <p>{t('explore.lede')}</p>
      </div>

      <div className="res-grid3">
        {SECTIONS.map((s) => (
          <Link key={s.to} to={s.to} className={`res-card ${s.tint}`}>
            <span className={`gicon ${s.tint}`} aria-hidden="true">
              <span className="res-emoji">{s.emoji}</span>
            </span>
            <h3>{t(s.titleKey)}</h3>
            <p>{t(s.descKey)}</p>
            <span className="res-card-go">
              {t('explore.open')} <svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </Link>
        ))}
      </div>

      {quick.length > 0 && (
        <div className="res-quick">
          <div className="res-quick-h">{t('explore.quickEmergency')}</div>
          <div className="res-quick-row">
            {quick.map((n) => (
              <a key={n.id} className="res-quick-pill" href={`tel:${n.number}`}>
                <span className="rq-label">{L(n.label, n.label_ar)}</span>
                <span className="rq-num">{n.number}</span>
              </a>
            ))}
            <Link to="/emergency" className="res-quick-all">{t('explore.allNumbers')}</Link>
          </div>
        </div>
      )}
    </ResourceLayout>
  )
}
