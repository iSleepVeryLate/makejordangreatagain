import { Link } from 'react-router-dom'
import ResourceLayout from '../components/ResourceLayout.jsx'
import Seo from '../components/Seo.jsx'
import { useResource } from '../hooks/useResource.js'

const SECTIONS = [
  {
    to: '/tourism', tint: 'a', emoji: '🏛️',
    title: 'Tourism & places to visit',
    desc: 'Petra, Wadi Rum, the Dead Sea, Jerash and more — explore Jordan’s wonders by governorate and category.',
  },
  {
    to: '/services', tint: 'g', emoji: '🏢',
    title: 'Government offices & services',
    desc: 'Civil status, passports, driving licences, taxes and municipalities — what they do, hours and how to reach them.',
  },
  {
    to: '/emergency', tint: 'r', emoji: '🚨',
    title: 'Emergency & useful numbers',
    desc: 'Police, ambulance, civil defense and other important hotlines — one tap to call.',
  },
]

export default function Explore() {
  const { rows: numbers } = useResource('emergency_numbers')
  const quick = numbers.slice(0, 4)

  return (
    <ResourceLayout>
      <Seo
        title="Explore Jordan — Resources for Residents"
        description="A free directory for everyone in Jordan: tourism spots, government offices and services, and emergency numbers. No account needed."
        path="/explore"
      />
      <div className="res-hero">
        <span className="res-eyebrow">A resource for residents</span>
        <h1>Everything you need, in one place</h1>
        <p>
          A growing, free directory for everyone in Jordan — where to go, who to call, and what to
          see. No account needed.
        </p>
      </div>

      <div className="res-grid3">
        {SECTIONS.map((s) => (
          <Link key={s.to} to={s.to} className={`res-card ${s.tint}`}>
            <span className={`gicon ${s.tint}`} aria-hidden="true">
              <span className="res-emoji">{s.emoji}</span>
            </span>
            <h3>{s.title}</h3>
            <p>{s.desc}</p>
            <span className="res-card-go">
              Open <svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </Link>
        ))}
      </div>

      {quick.length > 0 && (
        <div className="res-quick">
          <div className="res-quick-h">Quick emergency numbers</div>
          <div className="res-quick-row">
            {quick.map((n) => (
              <a key={n.id} className="res-quick-pill" href={`tel:${n.number}`}>
                <span className="rq-label">{n.label}</span>
                <span className="rq-num">{n.number}</span>
              </a>
            ))}
            <Link to="/emergency" className="res-quick-all">All numbers →</Link>
          </div>
        </div>
      )}
    </ResourceLayout>
  )
}
