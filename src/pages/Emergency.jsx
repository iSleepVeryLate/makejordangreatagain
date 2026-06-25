import ResourceLayout from '../components/ResourceLayout.jsx'
import Seo from '../components/Seo.jsx'
import { useResource } from '../hooks/useResource.js'

export default function Emergency() {
  const { rows, loading } = useResource('emergency_numbers')

  return (
    <ResourceLayout>
      <Seo
        title="Emergency & Useful Numbers in Jordan"
        description="Police, ambulance and civil defence (911), plus electricity, water and other essential hotlines for Jordan — tap to call."
        path="/emergency"
      />
      <div className="section-head">
        <h1>Emergency & useful numbers</h1>
        <p>Tap any number to call. In a life-threatening emergency, dial 911.</p>
      </div>

      <a className="emergency-hero" href="tel:911">
        <div className="eh-left">
          <div className="eh-label">Unified emergency</div>
          <div className="eh-sub">Police · Ambulance · Civil Defense</div>
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
                <div className="num-label">{n.label}</div>
                {n.description && <div className="num-desc">{n.description}</div>}
              </div>
              <div className="num-val">{n.number}</div>
            </a>
          ))}
        </div>
      )}
    </ResourceLayout>
  )
}
