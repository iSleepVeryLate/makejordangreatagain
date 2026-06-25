import { memo } from 'react'
import { BOARD, COLOR_GROUPS, tileName } from './monopolyBoard.js'
import { tokenMeta } from './monopolyTokens.js'
import { Landmark, Train, Lightbulb, Droplet, HelpCircle, Package, Car, Gem } from 'lucide-react'

// 11×11 CSS grid. The 40 tiles sit on the perimeter; the centre (rows/cols 2-10)
// is a slot for the dice + controls + log passed in as children.
function gridPos(i) {
  if (i <= 10) return { gridRow: 11, gridColumn: 11 - i }   // bottom row, right→left
  if (i <= 20) return { gridColumn: 1, gridRow: 21 - i }    // left col, bottom→top
  if (i <= 30) return { gridRow: 1, gridColumn: i - 19 }    // top row, left→right
  return { gridColumn: 11, gridRow: i - 29 }                // right col, top→bottom
}

const isCorner = (i) => i === 0 || i === 10 || i === 20 || i === 30

function TileIcon({ t }) {
  if (t.type === 'railroad') return <Train size={15} />
  if (t.type === 'utility') return t.i === 12 ? <Lightbulb size={15} /> : <Droplet size={15} />
  if (t.type === 'chance') return <HelpCircle size={15} />
  if (t.type === 'chest') return <Package size={15} />
  if (t.type === 'go_to_jail') return <Car size={15} />
  if (t.type === 'tax') return <Gem size={15} />
  if (t.type === 'go') return <Landmark size={15} />
  return null
}

const Tile = memo(function Tile({ t, prop, lang, occupants, ownerColor, onClick }) {
  const owned = prop && prop.owner
  const houses = prop?.houses || 0
  return (
    <button
      className={`mono-tile mono-tile-${t.type}${isCorner(t.i) ? ' corner' : ''}${owned ? ' owned' : ''}`}
      style={gridPos(t.i)}
      onClick={() => onClick && onClick(t.i)}
      aria-label={tileName(t, lang)}
      data-tile={t.i}
    >
      {t.type === 'property' && (
        <span className="mono-tile-bar" style={{ background: COLOR_GROUPS[t.color]?.hex }} aria-hidden />
      )}
      <span className="mono-tile-body">
        {t.type !== 'property' && <span className="mono-tile-ic"><TileIcon t={t} /></span>}
        <span className="mono-tile-name">{tileName(t, lang)}</span>
        {(t.type === 'property' || t.type === 'railroad' || t.type === 'utility') && !owned && (
          <span className="mono-tile-price">{t.price}</span>
        )}
      </span>

      {owned && (
        <span className="mono-tile-owner" style={{ background: ownerColor }} aria-hidden />
      )}
      {prop?.mortgaged && <span className="mono-tile-mortgaged" aria-hidden>⌧</span>}
      {houses > 0 && (
        <span className="mono-tile-houses" aria-hidden>
          {houses === 5 ? <span className="hotel" /> : Array.from({ length: houses }).map((_, k) => <span key={k} className="house" />)}
        </span>
      )}

      {occupants.length > 0 && (
        <span className="mono-tile-tokens" aria-hidden>
          {occupants.map((o, k) => (
            <span key={o.profile_id} className="mono-token-dot" style={{ '--tok': tokenMeta(o.token).color, '--k': k }} title={o.token}>
              {tokenMeta(o.token).emoji}
            </span>
          ))}
        </span>
      )}
    </button>
  )
})

function MonopolyBoard({ players, properties, lang, playerColor, onTile, children }) {
  const propByTile = {}
  for (const p of properties) propByTile[p.tile_index] = p
  const occByTile = {}
  for (const pl of players) {
    if (pl.bankrupt) continue
    ;(occByTile[pl.position] = occByTile[pl.position] || []).push(pl)
  }
  return (
    <div className="mono-board" role="group" aria-label="Monopoly board">
      {BOARD.map((t) => (
        <Tile
          key={t.i}
          t={t}
          prop={propByTile[t.i]}
          lang={lang}
          occupants={occByTile[t.i] || []}
          ownerColor={propByTile[t.i]?.owner ? playerColor[propByTile[t.i].owner] : undefined}
          onClick={onTile}
        />
      ))}
      <div className="mono-center">{children}</div>
    </div>
  )
}

export default memo(MonopolyBoard)
