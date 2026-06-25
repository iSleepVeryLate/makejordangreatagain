import { Component } from 'react'
import { Link } from 'react-router-dom'

// Catches render-time errors in any route so a single broken page shows a
// recoverable fallback instead of unmounting the whole app (which leaves a blank
// screen that survives client-side navigation until a hard refresh). `resetKey`
// is the current pathname: navigating to a different route clears the error so a
// soft nav recovers without a full reload.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-main">
          <div className="app-wrap center">
            <div className="empty-state">
              Something went wrong on this page.
              <div style={{ marginTop: 18, display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="btn btn-green btn-sm" onClick={() => window.location.reload()}>
                  Reload
                </button>
                <Link className="btn btn-line btn-sm" to="/play">Back to games</Link>
              </div>
            </div>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}
