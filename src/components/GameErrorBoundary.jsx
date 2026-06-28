import { Component, Fragment } from 'react'

// A scoped error boundary for the live game canvas. Unlike the app-wide
// ErrorBoundary (which routes the user to /play), this one recovers IN PLACE:
// the `fallback` render-prop offers a manual retry, and a newer authoritative
// snapshot (`resetKey`, the room seq) auto-clears a stale-state crash with no
// click — so a transient render error never ejects a player from their room.
//
// Props:
//   fallback(error, retry) -> ReactNode   shown while errored
//   resetKey                              changing it clears an active error
//   onRetry()                             called by retry() (e.g. refetch state)
export default class GameErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, nonce: 0 }
    this.retry = this.retry.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[GameErrorBoundary]', error, info?.componentStack)
  }

  componentDidUpdate(prev) {
    // A newer committed snapshot arrived — clear a stale-state crash with no click.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState((s) => ({ error: null, nonce: s.nonce + 1 }))
    }
  }

  retry() {
    try { this.props.onRetry?.() } catch { /* ignore */ }
    this.setState((s) => ({ error: null, nonce: s.nonce + 1 }))
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ? this.props.fallback(this.state.error, this.retry) : null
    }
    // Re-keying on the nonce forces a fresh mount of the subtree on retry so any
    // bad local component state is discarded along with the error.
    return <Fragment key={this.state.nonce}>{this.props.children}</Fragment>
  }
}
