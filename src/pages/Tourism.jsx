import { useMemo, useState } from 'react'
import ResourceLayout from '../components/ResourceLayout.jsx'
import { useResource } from '../hooks/useResource.js'
import { GOVERNORATES, TOURISM_CATEGORIES, tourismCat } from '../data/jordan.js'

export default function Tourism() {
  const { rows, loading } = useResource('tourism_spots')
  const [gov, setGov] = useState('all')
  const [cat, setCat] = useState('all')

  // Dataset is small, so filter in-memory rather than re-querying per chip.
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (gov === 'all' || r.governorate === gov) &&
          (cat === 'all' || r.category === cat),
      ),
    [rows, gov, cat],
  )

  return (
    <ResourceLayout>
      <div className="section-head">
        <h1>Tourism & places to visit</h1>
        <p>Discover Jordan’s archaeological wonders, nature reserves and seaside escapes.</p>
      </div>

      <div className="chip-row">
        <button className={`chip${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>
          All types
        </button>
        {TOURISM_CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={`chip${cat === c.key ? ' on' : ''}`}
            onClick={() => setCat(c.key)}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      <div className="chip-row sub">
        <button className={`chip sm${gov === 'all' ? ' on' : ''}`} onClick={() => setGov('all')}>
          All Jordan
        </button>
        {GOVERNORATES.map((g) => (
          <button key={g} className={`chip sm${gov === g ? ' on' : ''}`} onClick={() => setGov(g)}>
            {g}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="res-cards">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton skel-card" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">No spots match those filters yet.</div>
      ) : (
        <div className="res-cards">
          {filtered.map((s) => {
            const c = tourismCat(s.category)
            const tint = c?.tint || 'g'
            return (
              <article key={s.id} className={`res-item ${tint}`}>
                <div className="res-item-top">
                  <span className={`gicon sm ${tint}`} aria-hidden="true">
                    <span className="res-emoji">{c?.emoji || '📍'}</span>
                  </span>
                  <span className="tag">{s.governorate}</span>
                </div>
                <h3>{s.name}</h3>
                {s.summary && <p>{s.summary}</p>}
                {(s.entry_fee || s.best_time) && (
                  <div className="res-item-meta">
                    {s.entry_fee && (
                      <span className="meta-pill">
                        <svg className="ic" viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                        {s.entry_fee}
                      </span>
                    )}
                    {s.best_time && (
                      <span className="meta-pill">
                        <svg className="ic" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                        {s.best_time}
                      </span>
                    )}
                  </div>
                )}
                <div className="res-item-foot">
                  {c && <span className="res-cat">{c.label}</span>}
                  {s.maps_url && (
                    <a className="res-link" href={s.maps_url} target="_blank" rel="noopener">
                      Open in Maps
                      <svg className="ic" viewBox="0 0 24 24"><path d="M7 17 17 7M7 7h10v10" /></svg>
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
