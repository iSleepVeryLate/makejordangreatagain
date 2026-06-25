import ResourceLayout from '../components/ResourceLayout.jsx'
import Seo from '../components/Seo.jsx'
import { useResource } from '../hooks/useResource.js'
import { useLang } from '../context/LanguageContext.jsx'

export default function Emergency() {
  const { rows, loading } = useResource('emergency_numbers')
  const { t, lang } = useLang()
  const L = (en, ar) => (lang === 'ar' && ar ? ar : en)

  return (
    <ResourceLayout>
      <Seo
        title="Emergency & Useful Numbers in Jordan"
        description="Police, ambulance and civil defence (911), plus electricity, water and other essential hotlines for Jordan — tap to call."
        path="/emergency"
      />
      <div className="section-head">
        <h1>{t('emergency.title')}</h1>
        <p>{t('emergency.subtitle')}</p>
      </div>

      <a className="emergency-hero" href="tel:911">
        <div className="eh-left">
          <div className="eh-label">{t('emergency.unified')}</div>
          <div className="eh-sub">{t('emergency.unifiedSub')}</div>
        </div>
        <div className="eh-num">911</div>
      </a>

      {loading ? (
        <div className="num-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton skel-svc" />
          ))}
        </div>
      ) : (
        <div className="num-grid">
          {rows.map((n) => (
            <a key={n.id} className="num-card" href={`tel:${n.number.replace(/\s/g, '')}`}>
              <div className="num-info">
                <div className="num-label">{L(n.label, n.label_ar)}</div>
                {L(n.description, n.description_ar) && (
                  <div className="num-desc">{L(n.description, n.description_ar)}</div>
                )}
              </div>
              <div className="num-val">{n.number}</div>
            </a>
          ))}
        </div>
      )}
    </ResourceLayout>
  )
}
