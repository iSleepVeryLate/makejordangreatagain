import { Link } from 'react-router-dom'

// The Jordan flag logo mark, reused in the app navbar + auth card.
export function Mark() {
  return (
    <span className="mark">
      <span className="b"></span>
      <span className="w"></span>
      <span className="g"></span>
      <span className="tri"></span>
      <svg className="st" viewBox="0 0 24 24">
        <path d="M12 2l2.6 6.3 6.8.5-5.2 4.4 1.7 6.6L12 16.8 6.1 20.3l1.7-6.6L2.6 8.8l6.8-.5z" />
      </svg>
    </span>
  )
}

export default function BrandMark({ to = '/' }) {
  return (
    <Link className="brand" to={to}>
      <Mark />
      Jordan Stand Tall
    </Link>
  )
}
