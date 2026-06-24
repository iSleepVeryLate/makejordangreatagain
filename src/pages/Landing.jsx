import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useCommunityStats } from '../hooks/useCommunityStats.js'

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
  const closeMenu = () => setOpen(false)

  return (
    <>
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
            <a href="#community" onClick={closeMenu}>Community</a>
            <a href="#features" onClick={closeMenu}>What's inside</a>
            <Link to="/play" onClick={closeMenu}>Games</Link>
            <a href="#faq" onClick={closeMenu}>FAQ</a>
            {session ? (
              <Link className="btn btn-discord" to="/play" onClick={closeMenu}>
                Open game hub
              </Link>
            ) : (
              <Link className="btn btn-discord" to="/login" onClick={closeMenu}>
                <DiscordIcon /> Sign in
              </Link>
            )}
          </div>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="wrap hero-grid">
          <div>
            <span className="pill"><span className="dot"></span> A community, not a campaign</span>
            <h1 id="community">
              Jordanians,<br />
              <span className="gr">standing</span> <span className="rd">tall</span> together.
            </h1>
            <p className="lede">
              A warm online home for the people and residents of Jordan to connect, share
              culture, and play games together. Pull up a seat — the kettle's on.
            </p>
            <div className="hero-btns">
              <Link className="btn btn-discord btn-lg" to={session ? '/play' : '/login'}>
                <DiscordIcon /> {session ? 'Open game hub' : 'Sign in & play games'}
              </Link>
              <a className="btn btn-ghost btn-lg" href={DISCORD_INVITE} target="_blank" rel="noopener">
                Join the Discord
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
              <span>Loved by Jordanians at home and abroad</span>
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
          <div className="stat"><div className="num g">{formatNum(memberCount) ?? '…'}</div><div className="lbl">members</div></div>
          <div className="stat"><div className="num g">{formatNum(onlineCount) ?? '…'}</div><div className="lbl">online now</div></div>
          <div className="stat"><div className="num">12</div><div className="lbl">governorates represented</div></div>
          <div className="stat"><div className="num">Daily</div><div className="lbl">chats, voice &amp; game nights</div></div>
        </div>
      </section>

      <section className="disclaimer">
        <div className="wrap disc-inner">
          <span className="disc-badge">
            <svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
            Not a political party
          </span>
          <span className="disc-text">This site is the home of the <em>Jordan Stand Tall</em> Discord community only — a cultural gathering place for Jordanians, with no affiliation to any political party, movement, government body, or campaign.</span>
        </div>
      </section>

      <section className="block" id="features">
        <div className="wrap">
          <div className="eyebrow">What you'll find inside</div>
          <h2 className="h2">A community that feels like home</h2>
          <p className="sub">Real people, warm conversation, and games to play together — wherever in the world you are.</p>
          <div className="grid3">
            <div className="card">
              <div className="icbox g"><svg className="ic" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></svg></div>
              <h3>Real community</h3>
              <p>Lively channels for hometowns, food, football, music, and everyday life across the kingdom and the diaspora.</p>
            </div>
            <div className="card">
              <div className="icbox r"><svg className="ic" viewBox="0 0 24 24"><path d="M20.8 6.6a5.5 5.5 0 0 0-7.8 0L12 7.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 22l8.8-7.6a5.5 5.5 0 0 0 0-7.8z" /></svg></div>
              <h3>Look out for each other</h3>
              <p>Share tips, ask for advice, and lend a helping hand. This is a space where members genuinely support one another.</p>
            </div>
            <div className="card">
              <div className="icbox w"><svg className="ic" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M7 12h4M9 10v4M15.5 13h.01M18 11h.01" /></svg></div>
              <h3>Games &amp; tournaments</h3>
              <p>Sign in and play Tic-Tac-Toe, Connect Four, Chess and Jordan Trivia head-to-head. Climb the leaderboard and challenge friends.</p>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <Link className="btn btn-red btn-lg" to={session ? '/play' : '/login'}>
              {session ? 'Open the game hub' : 'Sign in & start playing'}
              <svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </Link>
          </div>
        </div>
      </section>

      <section className="values">
        <div className="wrap values-grid">
          <div className="val">
            <svg className="ic vi" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            <h4>Respect first</h4>
            <p>Everyone is welcome and treated with kindness, no exceptions.</p>
          </div>
          <div className="val">
            <svg className="ic vi" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" /></svg>
            <h4>Open to all</h4>
            <p>Jordanians at home, abroad, and friends of Jordan are all family here.</p>
          </div>
          <div className="val">
            <svg className="ic vi" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>
            <h4>Always free</h4>
            <p>No fees, no catch. A community space, now and always.</p>
          </div>
          <div className="val">
            <svg className="ic vi" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9zM13.7 21a2 2 0 0 1-3.4 0" /></svg>
            <h4>Active &amp; moderated</h4>
            <p>A friendly team keeps things safe, on-topic, and welcoming.</p>
          </div>
        </div>
      </section>

      <section className="block" id="faq">
        <div className="wrap">
          <div className="eyebrow">Good to know</div>
          <h2 className="h2">Frequently asked questions</h2>
          <p className="sub">A few quick answers before you join.</p>
          <div className="faq">
            <details open>
              <summary>Is this a political party or movement?<svg className="ic chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></summary>
              <p>No. Jordan Stand Tall is purely a social and cultural community for Jordanians. We have no affiliation with any political party, movement, government body, or campaign — and we never will.</p>
            </details>
            <details>
              <summary>How do the games work?<svg className="ic chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></summary>
              <p>Sign in with your Discord account, head to the game hub, and challenge other members to Tic-Tac-Toe, Connect Four, Chess, or Jordan Trivia in real time. Wins earn you rating points on the leaderboard.</p>
            </details>
            <details>
              <summary>Who can join?<svg className="ic chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></summary>
              <p>Anyone who loves Jordan — residents, citizens at home or abroad, and friends of Jordan. Everyone is welcome.</p>
            </details>
            <details>
              <summary>Does it cost anything?<svg className="ic chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></summary>
              <p>Not a thing. The community and the games are completely free to join and take part in.</p>
            </details>
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="wrap cta-inner">
          <svg className="star" viewBox="0 0 24 24"><Star /></svg>
          <h2>Ready to stand tall with us?</h2>
          <p>Everyone who loves Jordan is welcome. Free, friendly, and always will be.</p>
          <Link className="btn btn-red" to={session ? '/play' : '/login'}>
            <DiscordIcon size={21} />
            {session ? 'Open the game hub' : 'Sign in & play'}
          </Link>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div className="foot-top">
            <div className="foot-brand">
              <div className="brand"><Brand /></div>
              <p>A warm, independent online home for the people of Jordan.</p>
            </div>
            <div className="foot-cols">
              <div className="foot-col">
                <h5>Community</h5>
                <a href="#features">What's inside</a>
                <Link to="/play">Games</Link>
                <a href="#faq">FAQ</a>
                <a href={DISCORD_INVITE} target="_blank" rel="noopener">Join Discord</a>
              </div>
              <div className="foot-col">
                <h5>Play</h5>
                <Link to="/login">Sign in</Link>
                <Link to="/leaderboard">Leaderboard</Link>
                <a href="#faq">Not political</a>
              </div>
            </div>
          </div>
          <div className="foot-bottom">
            <span>makejordangreatagain.com — © 2026 Jordan Stand Tall community</span>
            <span className="foot-note">An independent, non-political community space. Not affiliated with any party, government, or campaign.</span>
          </div>
        </div>
      </footer>
    </>
  )
}
