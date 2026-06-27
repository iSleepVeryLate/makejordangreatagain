import { memo } from 'react'
import { BOARD, COLOR_GROUPS, tileName } from './monopolyBoard.js'
import { gridPos, tileSide } from './monopolyGeometry.js'
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

const Tile = memo(function Tile({ t, prop, lang, ownerColor, active, onClick, tt }) {
  const owned = !!(prop && prop.owner)
  const houses = prop?.houses || 0
  const side = tileSide(t.i)
  const ownable = t.type === 'property' || t.type === 'railroad' || t.type === 'utility'
  const corner = isCorner(t.i)
  return (
    <button
      className={`mono-tile mono-tile-${t.type}${corner ? ' corner' : ''}${owned ? ' owned' : ''}${active ? ' active' : ''}`}
      style={cssPos(t.i)}
      onClick={() => onClick && onClick(t.i)}
      aria-label={tileName(t, lang)}
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

      {owned && <span className="mono-tile-own" style={{ '--ow': ownerColor }} aria-hidden />}

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

function MonopolyBoard({ players, properties, lang, playerColor, activeTile, onTile, store, tt, children }) {
  const propByTile = {}
  for (const p of properties) propByTile[p.tile_index] = p
  return (
    // dir=ltr is load-bearing: the board uses explicit grid column numbers and
    // RTL would mirror the whole board (GO would jump to the wrong corner). The
    // surrounding chrome stays RTL; only the geometry is pinned LTR.
    <div className="mono-board" role="group" aria-label="Monopoly board" dir="ltr">
      <span className="mono-board-watermark" aria-hidden>JO</span>
      {BOARD.map((t) => (
        <Tile
          key={t.i}
          t={t}
          prop={propByTile[t.i]}
          lang={lang}
          ownerColor={propByTile[t.i]?.owner ? playerColor[propByTile[t.i].owner] : undefined}
          active={t.i === activeTile}
          onClick={onTile}
          tt={tt}
        />
      ))}
      {store && <TokenLayer players={players} store={store} />}
      {store && <MoneyFloatLayer store={store} />}
      <div className="mono-center">{children}</div>
    </div>
  )
}

export default memo(MonopolyBoard)
