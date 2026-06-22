import { memo } from 'react'

function ConnectFour({ match, makeMove, disabled }) {
  const grid = match.board_state?.grid || Array(42).fill(0)

  // top cell of a column (row 0) being filled means the column is full
  const colFull = (col) => grid[col] !== 0

  const drop = (col) => {
    if (disabled || colFull(col)) return
    makeMove({ col })
  }

  return (
    <div className="c4">
      {Array.from({ length: 7 }).map((_, col) => (
        <button
          key={col}
          type="button"
          className={`c4-col${colFull(col) ? ' full' : ''}${disabled ? ' disabled' : ''}`}
          onClick={() => drop(col)}
          disabled={disabled || colFull(col)}
          aria-label={`Drop in column ${col + 1}`}
        >
          {Array.from({ length: 6 }).map((_, row) => {
            const v = grid[row * 7 + col]
            return (
              <div
                key={row}
                className={`c4-cell ${v === 1 ? 'p1' : v === 2 ? 'p2' : 'empty'}`}
              />
            )
          })}
        </button>
      ))}
    </div>
  )
}

export default memo(ConnectFour)
