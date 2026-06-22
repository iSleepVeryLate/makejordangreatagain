import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'

export default function Trivia({ match, myId, answerTrivia }) {
  const bs = match.board_state || {}
  const round = bs.round || 0
  const total = bs.total || 0
  const qids = bs.question_ids || []
  const scores = bs.scores || {}
  const answered = bs.answered || {}

  const qid = qids[round]
  const roundAns = answered[String(round)] || {}
  const iAnswered = roundAns[myId]
  const oppId = match.player1 === myId ? match.player2 : match.player1

  const [question, setQuestion] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    if (!qid) {
      setQuestion(null)
      return
    }
    supabase
      .from('trivia_public')
      .select('*')
      .eq('id', qid)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setQuestion(data)
      })
    return () => {
      active = false
    }
  }, [qid])

  // Finished / abandoned — show the final tally instead of an empty board.
  if (match.status !== 'active') {
    return (
      <div className="trivia trivia-final">
        <div className="trivia-final-h">Final score</div>
        <div className="trivia-score big">
          <span style={{ color: 'var(--green-bright)' }}>You · {scores[myId] || 0}</span>
          <span style={{ color: 'var(--txt-mid)' }}>Opponent · {scores[oppId] || 0}</span>
        </div>
        <div className="trivia-final-note">{total} question{total === 1 ? '' : 's'}</div>
      </div>
    )
  }
  if (!question) {
    return <div className="spinner" />
  }

  const pick = async (i) => {
    if (iAnswered || submitting) return
    setSubmitting(true)
    await answerTrivia(i)
    setSubmitting(false)
  }

  const myScore = scores[myId] || 0
  const oppScore = scores[oppId] || 0
  const choices = question.choices || []

  return (
    <div className="trivia">
      <div className="trivia-progress">
        <span>Question {round + 1} of {total}</span>
        <span style={{ textTransform: 'capitalize' }}>{question.category}</span>
      </div>
      <div className="trivia-score">
        <span style={{ color: 'var(--green-bright)' }}>You · {myScore}</span>
        <span style={{ color: 'var(--txt-mid)' }}>Opponent · {oppScore}</span>
      </div>
      <div className="trivia-q">{question.question}</div>
      <div className="trivia-choices">
        {choices.map((c, i) => {
          let cls = 'choice-btn'
          if (iAnswered && iAnswered.choice === i) {
            cls += iAnswered.correct ? ' correct' : ' wrong'
          } else if (iAnswered) {
            cls += ' picked'
          }
          return (
            <button
              key={i}
              className={cls}
              disabled={!!iAnswered || submitting}
              onClick={() => pick(i)}
            >
              {c}
            </button>
          )
        })}
      </div>
      {iAnswered && (
        <div className="trivia-wait">
          {iAnswered.correct ? '✅ Correct!' : '❌ Not quite.'} Waiting for your opponent to answer…
        </div>
      )}
    </div>
  )
}
