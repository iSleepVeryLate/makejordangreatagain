import { memo } from 'react'
import { BOARD, COLOR_GROUPS, tileName } from './monopolyBoard.js'
import { ownerBorderColor } from './colorUtil.js'
import { gridPos, tileSide } from './monopolyGeometry.js'
import { buildableHint, rentNow } from './monopolyAffordance.js'
import TokenLayer from './TokenLayer.jsx'
import MoneyFloatLayer from './MoneyFloat.jsx'
import {
  Train, Lightbulb, Droplet, HelpCircle, Package, Gem,
  ArrowBigDown, Lock, CircleParking, Siren,
} from 'lucide-react'

const isCorner = (i) => i === 0 || i === 10 || i === 20 || i === 30
const cssPos = (i) => { const { row, col } = gridPos(i); return { gridRow: row, gridColumn: col } }

function TileIcon({ t }) {
  if (t.type === 'railroad') return <Train size={16} />
  if (t.type === 'utility') return t.i === 12 ? <Lightbulb size={16} /> : <Droplet size={16} />
  if (t.type === 'chance') return <HelpCircle size={16} />
  if (t.type === 'chest') return <Package size={16} />
  if (t.type === 'tax') return <Gem size={16} />
  return null
}

function CornerInner({ t, lang, tt }) {
  if (t.type === 'go') return (
    <>
      <span className="mono-corner-ic"><ArrowBigDown size={22} /></span>
      <span className="mono-corner-main">{tileName(t, lang)}</span>
      <span className="mono-corner-sub">{tt('mono.goSub')}</span>
    </>
  )
  if (t.type === 'jail') return (
    <>
      <span className="mono-corner-ic"><Lock size={20} /></span>
      <span className="mono-corner-main">{tt('mono.jailMain')}</span>
      <span className="mono-corner-sub">{tt('mono.jailSub')}</span>
    </>
  )
  if (t.type === 'free_parking') return (
    <>
      <span className="mono-corner-ic"><CircleParking size={22} /></span>
      <span className="mono-corner-main">{tileName(t, lang)}</span>
    </>
  )
  return (
    <>
      <span className="mono-corner-ic"><Siren size={20} /></span>
      <span className="mono-corner-main">{tileName(t, lang)}</span>
    </>
  )
}

// All extra props are PRIMITIVES precomputed by the board, so the memo holds and
// a token hop (which never re-renders the board) never re-renders a tile.
const Tile = memo(function Tile({ t, prop, lang, ownerColor, owner, active, auction, mine, setComplete, buildable, title, onClick, tt }) {
  const owned = !!owner
  const houses = prop?.houses || 0
  const side = tileSide(t.i)
  const ownable = t.type === 'property' || t.type === 'railroad' || t.type === 'utility'
  const corner = isCorner(t.i)
  const cls = `mono-tile mono-tile-${t.type}${corner ? ' corner' : ''}${owned ? ' owned' : ''}`
    + `${mine ? ' mine' : ''}${setComplete ? ' set' : ''}${buildable ? ' buildable' : ''}`
    + `${active ? ' active' : ''}${auction ? ' auction' : ''}${prop?.mortgaged ? ' mortgaged' : ''}`
  return (
    <button
      className={cls}
      style={cssPos(t.i)}
      onClick={() => onClick && onClick(t.i)}
      aria-label={tileName(t, lang)}
      title={title}
      data-tile={t.i}
    >
      {t.type === 'property' && (
        <span className={`mono-tile-band ${side}`} style={{ background: COLOR_GROUPS[t.color]?.hex }} aria-hidden />
      )}

      <span className={`mono-tile-body${t.type === 'property' ? ` pad-${side}` : ''}`}>
        {corner ? (
          <CornerInner t={t} lang={lang} tt={tt} />
        ) : (
          <>
            {t.type !== 'property' && <span className="mono-tile-ic"><TileIcon t={t} /></span>}
            <span className="mono-tile-name">{tileName(t, lang)}</span>
            {ownable && !owned && <span className="mono-tile-price">{t.price}</span>}
          </>
        )}
      </span>

      {/* keyed on owner so a change of ownership remounts the stripe and replays
          the "deed stamp" animation (same re-key trick as the token hop). */}
      {/* ITEM 1 — --ow drives the faint owner-coloured fill; --ow-border drives the
          border itself. For a LIGHT owner colour the border uses a DARKENED, same-hue
          variant (ownerBorderColor) so a near-white owner separates from the cream tile;
          dark owners get their raw colour for both. Mirrors the 3D bake. */}
      {owned && <span key={owner} className="mono-tile-own" style={{ '--ow': ownerColor, '--ow-border': ownerColor ? ownerBorderColor(ownerColor) : undefined }} aria-hidden />}

      {houses > 0 && (
        <span className={`mono-tile-houses ${side}`} aria-hidden>
          {houses === 5
            ? <i className="hotel" />
            : Array.from({ length: houses }).map((_, k) => <i key={k} />)}
        </span>
      )}

      {prop?.mortgaged && <span className="mono-tile-mortgaged" aria-hidden>⌧</span>}
    </button>
  )
})

function MonopolyBoard({ players, propByTile, lang, playerColor, nameById, myId, myFullSets, auctionTile, activeTile, onTile, store, tt, children, moment }) {
  // Richer hover tooltip via the native title attribute (escapes the tile's
  // overflow:hidden + the dir=ltr/container-query transforms a CSS tooltip can't).
  const tipFor = (t, prop) => {
    const ownable = t.type === 'property' || t.type === 'railroad' || t.type === 'utility'
    const parts = [tileName(t, lang)]
    if (prop?.owner) {
      if (nameById?.[prop.owner]) parts.push(nameById[prop.owner])
      const r = rentNow(t, prop, propByTile)
      if (r) parts.push(`${tt('mono.rentNow')}: ${r.kind === 'dice' ? `${r.mult}× 🎲` : r.amount}`)
      if (prop.mortgaged) parts.push(tt('mono.deedMortgaged'))
      if (prop.owner === myId && t.color && myFullSets?.has(t.color)) parts.push(tt('mono.tipSet'))
    } else if (ownable && t.price) {
      parts.push(`${t.price}`)
    }
    return parts.filter(Boolean).join(' · ')
  }
  return (
    // dir=ltr is load-bearing: the board uses explicit grid column numbers and
    // RTL would mirror the whole board (GO would jump to the wrong corner). The
    // surrounding chrome stays RTL; only the geometry is pinned LTR.
    <div className="mono-board" role="group" aria-label="Monopoly board" dir="ltr">
      {BOARD.map((t) => {
        const prop = propByTile[t.i]
        const owner = prop?.owner || null
        const mine = owner === myId
        return (
          <Tile
            key={t.i}
            t={t}
            prop={prop}
            lang={lang}
            owner={owner}
            ownerColor={owner ? playerColor[owner] : undefined}
            active={t.i === activeTile}
            auction={t.i === auctionTile}
            mine={mine}
            setComplete={!!(mine && t.color && myFullSets?.has(t.color))}
            buildable={buildableHint(t, prop, propByTile, myId)}
            title={tipFor(t, prop)}
            onClick={onTile}
            tt={tt}
          />
        )
      })}
      {store && <TokenLayer players={players} store={store} />}
      {store && <MoneyFloatLayer store={store} />}
      <div className="mono-center">{children}</div>
      {moment}
    </div>
  )
}

export default memo(MonopolyBoard)
