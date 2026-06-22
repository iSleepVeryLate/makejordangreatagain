export default function TicTacToe({ match, makeMove, disabled }) {
  const cells = match.board_state?.cells || Array(9).fill('')

  const click = (i) => {
    if (disabled || cells[i] !== '') return
    makeMove({ cell: i })
  }

  return (
    <div className="ttt">
      {cells.map((c, i) => (
        <button
          key={i}
          className={`ttt-cell${c ? ' filled' : ''}${disabled ? ' disabled' : ''}`}
          onClick={() => click(i)}
          disabled={disabled || c !== ''}
          aria-label={`cell ${i + 1}`}
        >
          {c === 'X' && <span className="x">X</span>}
          {c === 'O' && <span className="o">O</span>}
        </button>
      ))}
    </div>
  )
}
