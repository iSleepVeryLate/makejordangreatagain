import { useMemo, useState } from 'react'
import ResourceLayout from '../components/ResourceLayout.jsx'
import Seo from '../components/Seo.jsx'
import { useResource } from '../hooks/useResource.js'
import { SERVICE_CATEGORIES, serviceCat } from '../data/jordan.js'

// Normalise a website value into a safe absolute https URL.
function siteUrl(site) {
  return site.startsWith('http') ? site : `https://${site}`
}

export default function Services() {
  const { rows, loading } = useResource('gov_services')
  const [cat, setCat] = useState('all')

  const filtered = useMemo(
    () => rows.filter((r) => cat === 'all' || r.category === cat),
    [rows, cat],
  )

  return (
    <ResourceLayout>
      <Seo
        title="Government Offices & Services in Jordan"
        description="Civil status, passports, driving licences, taxes, social security and municipalities — official phone numbers, hours and websites."
        path="/services"
      />
      <div className="section-head">
        <h1>Government offices & services</h1>
        <p>Key departments and what they handle — with hours, phone numbers and official websites.</p>
      </div>

      <div className="chip-row">
        <button className={`chip${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>
          All services
        </button>
        {SERVICE_CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={`chip${cat === c.key ? ' on' : ''}`}
            onClick={() => setCat(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="res-rows">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton skel-svc" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">No services match that filter yet.</div>
      ) : (
        <div className="res-rows">
          {filtered.map((s) => {
            const cm = serviceCat(s.category)
            const callNumber = s.hotline || s.phone
            return (
              <article key={s.id} className="svc-row">
                <div className="svc-main">
                  <div className="svc-name-row">
                    <h3>{s.name}</h3>
                    {cm && <span className="tag">{cm.label}</span>}
                  </div>
                  {s.summary && <p className="svc-sum">{s.summary}</p>}
                  <div className="svc-meta">
                    {s.hours && (
                      <span className="svc-chip">
                        <svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                        {s.hours}
                      </span>
                    )}
                    {s.governorate && <span className="svc-chip">📍 {s.governorate}</span>}
                  </div>
                </div>
                <div className="svc-actions">
                  {callNumber && (
                    <a className="btn btn-green btn-sm" href={`tel:${callNumber.replace(/\s/g, '')}`}>
                      <svg className="ic" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg>
                      {callNumber}
                    </a>
                  )}
                  {s.website && (
                    <a className="btn btn-line btn-sm" href={siteUrl(s.website)} target="_blank" rel="noopener">
                      Website
                    </a>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </ResourceLayout>
  )
}
