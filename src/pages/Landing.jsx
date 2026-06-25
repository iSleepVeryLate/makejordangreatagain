import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useCommunityStats } from '../hooks/useCommunityStats.js'
import { useLang } from '../context/LanguageContext.jsx'
import Seo from '../components/Seo.jsx'
import LangToggle from '../components/LangToggle.jsx'

const DISCORD_INVITE = 'https://discord.gg/makejordangreatagain'

// Exact number with thousands separators (e.g. "181", "1,240"). Returns null
// when we don't have a value yet so the caller can show a neutral placeholder.
function formatNum(n) {
  return typeof n === 'number' ? n.toLocaleString() : null
}

// Short form for the small avatar badge: "181", "1.2k", "12k".
function badgeCount(n) {
  if (typeof n !== 'number') return null
  if (n < 1000) return String(n)
  return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k'
}

function DiscordIcon({ size = 19 }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ width: size, height: size }}>
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.2.5a18.3 18.3 0 0 1 4.3 1.4 13.6 13.6 0 0 0-15 0A18.3 18.3 0 0 1 8.8 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9 0 13.5.3 17.9A19.9 19.9 0 0 0 6.4 21l.4-.6a11.9 11.9 0 0 1-1.9-.9l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.2.7-1.9.9l.4.6a19.9 19.9 0 0 0 6.1-3.1c.4-5.1-.6-9.6-2.9-13.5ZM8.3 15.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.4 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
    </svg>
  )
}

function Star() {
  return (
    <path d="M12 2l2.6 6.3 6.8.5-5.2 4.4 1.7 6.6L12 16.8 6.1 20.3l1.7-6.6L2.6 8.8l6.8-.5z" />
  )
}

function Brand() {
  return (
    <>
      <span className="mark">
        <span className="b"></span>
        <span className="w"></span>
        <span className="g"></span>
        <span className="tri"></span>
        <svg className="st" viewBox="0 0 24 24">
          <Star />
        </svg>
      </span>
      Jordan Stand Tall
    </>
  )
}

export default function Landing() {
  const [open, setOpen] = useState(false)
  const { session } = useAuth()
  const { memberCount, onlineCount } = useCommunityStats()
  const { t, dir, lang } = useLang()
  const closeMenu = () => setOpen(false)

  return (
    <div className="landing-root" dir={dir} lang={lang}>
      <Seo
        description="A free resource for the people and residents of Jordan: tourism spots, government services, emergency numbers, and a friendly community with games. A community, not a campaign."
        path="/"
      />
      <nav>
        <div className="wrap nav-inner">
          <Link className="brand" to="/" onClick={closeMenu}>
            <Brand />
          </Link>
          <button
            className="nav-toggle"
            aria-label="Toggle menu"
            onClick={() => setOpen((o) => !o)}
          >
            <svg className="ic" style={{ width: 26, height: 26 }} viewBox="0 0 24 24">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <div className={`nav-links${open ? ' open' : ''}`}>
            <a href="#community" onClick={closeMenu}>{t('land.nav.community')}</a>
            <a href="#features" onClick={closeMenu}>{t('land.nav.inside')}</a>
            <Link to="/explore" onClick={closeMenu}>{t('land.nav.explore')}</Link>
            <Link to="/play" onClick={closeMenu}>{t('land.nav.games')}</Link>
            <a href="#faq" onClick={closeMenu}>{t('land.nav.faq')}</a>
            <LangToggle />
            {session ? (
              <Link className="btn btn-discord" to="/play" onClick={closeMenu}>
                {t('land.nav.openhub')}
              </Link>
            ) : (
              <Link className="btn btn-discord" to="/login" onClick={closeMenu}>
                <DiscordIcon /> {t('land.nav.signin')}
              </Link>
            )}
          </div>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="wrap hero-grid">
          <div>
            <span className="pill"><span className="dot"></span> {t('land.hero.pill')}</span>
            {lang === 'ar' ? (
              <h1 id="community">
                الأردنيون،<br />
                <span className="gr">نقف</span> <span className="rd">شامخين</span> معًا.
              </h1>
            ) : (
              <h1 id="community">
                Jordanians,<br />
                <span className="gr">standing</span> <span className="rd">tall</span> together.
              </h1>
            )}
            <p className="lede">{t('land.hero.lede')}</p>
            <div className="hero-btns">
              <Link className="btn btn-discord btn-lg" to={session ? '/play' : '/login'}>
                <DiscordIcon /> {session ? t('land.nav.openhub') : t('land.hero.btnPlay')}
              </Link>
              <a className="btn btn-ghost btn-lg" href={DISCORD_INVITE} target="_blank" rel="noopener">
                {t('land.hero.join')}
                <svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </a>
            </div>
            <div className="trust">
              <div className="avatars">
                <span style={{ background: '#18a361' }}>A</span>
                <span style={{ background: '#e4002b' }}>M</span>
                <span style={{ background: '#3b82f6' }}>R</span>
                <span style={{ background: '#a855f7' }}>S</span>
                <span style={{ background: '#1a1c20', fontSize: 11, color: '#c4c8cd' }}>
                  +{badgeCount(memberCount) ?? '…'}
                </span>
              </div>
              <span>{t('land.hero.trust')}</span>
            </div>
          </div>

          <div className="preview" aria-hidden="true">
            <div className="pv-top">
              <span className="d" style={{ background: '#ff5f57' }}></span>
              <span className="d" style={{ background: '#febc2e' }}></span>
              <span className="d" style={{ background: '#28c840' }}></span>
              <span className="pv-title">discord.gg/makejordangreatagain</span>
            </div>
            <div className="pv-body">
              <div className="pv-rail">
                <div className="pv-server" style={{ background: 'linear-gradient(135deg,#18a361,#0f7a47)' }}>
                  <span className="pv-pillbar"></span>
                  <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, fill: '#fff' }}><Star /></svg>
                </div>
                <div className="pv-dotmini"></div>
                <div className="pv-dotmini"></div>
              </div>
              <div className="pv-main">
                <div className="pv-chanhead">Text channels</div>
                <div className="pv-chan active">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 4l-2 16M17 4l-2 16M4 9h16M3 15h16" /></svg> general
                </div>
                <div className="pv-chan">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 4l-2 16M17 4l-2 16M4 9h16M3 15h16" /></svg> food-and-mansaf
                </div>
                <div className="pv-chan">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 4l-2 16M17 4l-2 16M4 9h16M3 15h16" /></svg> football-talk
                </div>
                <div className="pv-chan">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5 6 9H2v6h4l5 4V5zM19 5a9 9 0 0 1 0 14M16 8a5 5 0 0 1 0 8" /></svg> evening-voice
                </div>
                <div className="pv-msg">
                  <div className="pv-ava">JS</div>
                  <div>
                    <div>
                      <span className="pv-name"><b>Jordan Stand Tall</b></span>
                      <span className="pv-time">today</span>
                    </div>
                    <div className="pv-text">Welcome home! Grab a role, say marhaba in #general, and challenge someone to a game tonight. 🇯🇴</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="stats">
        <div className="wrap stats-inner">
          <div className="stat"><div className="num g">{formatNum(memberCount) ?? '…'}</div><div className="lbl">{t('land.stats.members')}</div></div>
          <div className="stat"><div className="num g">{formatNum(onlineCount) ?? '…'}</div><div className="lbl">{t('land.stats.online')}</div></div>
          <div className="stat"><div className="num">12</div><div className="lbl">{t('land.stats.govs')}</div></div>
          <div className="stat"><div className="num">{t('land.stats.dailyNum')}</div><div className="lbl">{t('land.stats.dailyLbl')}</div></div>
        </div>
      </section>

      <section className="disclaimer">
        <div className="wrap disc-inner">
          <span className="disc-badge">
            <svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
            {t('land.disc.badge')}
          </span>
          <span className="disc-text">{t('land.disc.text')}</span>
        </div>
      </section>

      <section className="block" id="features">
        <div className="wrap">
          <div className="eyebrow">{t('land.feat.eyebrow')}</div>
          <h2 className="h2">{t('land.feat.h2')}</h2>
          <p className="sub">{t('land.feat.sub')}</p>
          <div className="grid3">
            <div className="card">
              <div className="icbox g"><svg className="ic" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></svg></div>
              <h3>{t('land.feat.c1h')}</h3>
              <p>{t('land.feat.c1p')}</p>
            </div>
            <div className="card">
              <div className="icbox r"><svg className="ic" viewBox="0 0 24 24"><path d="M20.8 6.6a5.5 5.5 0 0 0-7.8 0L12 7.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 22l8.8-7.6a5.5 5.5 0 0 0 0-7.8z" /></svg></div>
              <h3>{t('land.feat.c2h')}</h3>
              <p>{t('land.feat.c2p')}</p>
            </div>
            <div className="card">
              <div className="icbox w"><svg className="ic" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M7 12h4M9 10v4M15.5 13h.01M18 11h.01" /></svg></div>
              <h3>{t('land.feat.c3h')}</h3>
              <p>{t('land.feat.c3p')}</p>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <Link className="btn btn-red btn-lg" to={session ? '/play' : '/login'}>
              {session ? t('land.feat.ctaHub') : t('land.feat.cta')}
              <svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </Link>
          </div>
        </div>
      </section>

      <section className="values">
        <div className="wrap values-grid">
          <div className="val">
            <svg className="ic vi" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            <h4>{t('land.val.h1')}</h4>
            <p>{t('land.val.p1')}</p>
          </div>
          <div className="val">
            <svg className="ic vi" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" /></svg>
            <h4>{t('land.val.h2')}</h4>
            <p>{t('land.val.p2')}</p>
          </div>
          <div className="val">
            <svg className="ic vi" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>
            <h4>{t('land.val.h3')}</h4>
            <p>{t('land.val.p3')}</p>
          </div>
          <div className="val">
            <svg className="ic vi" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9zM13.7 21a2 2 0 0 1-3.4 0" /></svg>
            <h4>{t('land.val.h4')}</h4>
            <p>{t('land.val.p4')}</p>
          </div>
        </div>
      </section>

      <section className="block" id="explore-jordan">
        <div className="wrap">
          <div className="eyebrow">{t('land.res.eyebrow')}</div>
          <h2 className="h2">{t('land.res.h2')}</h2>
          <p className="sub">{t('land.res.sub')}</p>
          <div className="grid3">
            <Link className="card" to="/tourism">
              <div className="icbox a"><svg className="ic" viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l8-4 8 4v14M9 21v-6h6v6" /></svg></div>
              <h3>{t('land.res.c1h')}</h3>
              <p>{t('land.res.c1p')}</p>
            </Link>
            <Link className="card" to="/services">
              <div className="icbox g"><svg className="ic" viewBox="0 0 24 24"><path d="M3 21h18M6 21V8l6-4 6 4v13M10 12h4M10 16h4" /></svg></div>
              <h3>{t('land.res.c2h')}</h3>
              <p>{t('land.res.c2p')}</p>
            </Link>
            <Link className="card" to="/emergency">
              <div className="icbox r"><svg className="ic" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg></div>
              <h3>{t('land.res.c3h')}</h3>
              <p>{t('land.res.c3p')}</p>
            </Link>
          </div>
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <Link className="btn btn-green btn-lg" to="/explore">
              {t('land.res.cta')}
              <svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </Link>
          </div>
        </div>
      </section>

      <section className="block" id="faq">
        <div className="wrap">
          <div className="eyebrow">{t('land.faq.eyebrow')}</div>
          <h2 className="h2">{t('land.faq.h2')}</h2>
          <p className="sub">{t('land.faq.sub')}</p>
          <div className="faq">
            <details open>
              <summary>{t('land.faq.q1')}<svg className="ic chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></summary>
              <p>{t('land.faq.a1')}</p>
            </details>
            <details>
              <summary>{t('land.faq.q2')}<svg className="ic chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></summary>
              <p>{t('land.faq.a2')}</p>
            </details>
            <details>
              <summary>{t('land.faq.q3')}<svg className="ic chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></summary>
              <p>{t('land.faq.a3')}</p>
            </details>
            <details>
              <summary>{t('land.faq.q4')}<svg className="ic chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></summary>
              <p>{t('land.faq.a4')}</p>
            </details>
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="wrap cta-inner">
          <svg className="star" viewBox="0 0 24 24"><Star /></svg>
          <h2>{t('land.cta.h2')}</h2>
          <p>{t('land.cta.p')}</p>
          <Link className="btn btn-red" to={session ? '/play' : '/login'}>
            <DiscordIcon size={21} />
            {session ? t('land.cta.btnHub') : t('land.cta.btn')}
          </Link>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div className="foot-top">
            <div className="foot-brand">
              <div className="brand"><Brand /></div>
              <p>{t('land.foot.desc')}</p>
            </div>
            <div className="foot-cols">
              <div className="foot-col">
                <h5>{t('land.foot.community')}</h5>
                <a href="#features">{t('land.foot.inside')}</a>
                <Link to="/play">{t('land.foot.games')}</Link>
                <a href="#faq">{t('land.foot.faq')}</a>
                <a href={DISCORD_INVITE} target="_blank" rel="noopener">{t('land.foot.joindiscord')}</a>
              </div>
              <div className="foot-col">
                <h5>{t('land.foot.resources')}</h5>
                <Link to="/tourism">{t('land.foot.tourism')}</Link>
                <Link to="/services">{t('land.foot.services')}</Link>
                <Link to="/emergency">{t('land.foot.emergency')}</Link>
              </div>
              <div className="foot-col">
                <h5>{t('land.foot.play')}</h5>
                <Link to="/login">{t('land.foot.signin')}</Link>
                <Link to="/leaderboard">{t('land.foot.leaderboard')}</Link>
                <a href="#faq">{t('land.foot.notpolitical')}</a>
              </div>
            </div>
          </div>
          <div className="foot-bottom">
            <span>{t('land.foot.copyright')}</span>
            <span className="foot-note">{t('land.foot.note')}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
