import { useEffect, useState } from 'react'
import { useViewFinderStore } from '../state/store'

// Most fetches (especially cache hits, which are common while re-panning
// over recently-viewed areas) resolve faster than this - showing a loading
// message for those just adds visual noise/flicker rather than useful
// feedback. Only reveal it if a fetch is still running after a brief delay.
const LOADING_REVEAL_DELAY_MS = 250

// Maps the raw error text (network error codes, HTTP statuses, etc.) to a
// plain-language explanation. The exact original message is still kept as
// the element's `title` (a hover tooltip), so it's not lost for
// troubleshooting - it's just not the first thing a non-technical user has
// to read.
function friendlyMessage(error: string): string {
  if (/ERR_CONNECTION|ConnectTimeout|ETIMEDOUT|ENOTFOUND|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(error)) {
    return "Couldn't reach OpenStreetMap's servers — check your internet connection and try again."
  }
  if (/\b429\b/.test(error)) {
    return "OpenStreetMap's free server is asking us to slow down — try again in a moment."
  }
  if (/\b50[234]\b/.test(error)) {
    return "OpenStreetMap's free server is temporarily unavailable — try again in a moment."
  }
  return "Couldn't load viewpoints — try again in a moment."
}

export function StatusHint(): React.JSX.Element | null {
  const status = useViewFinderStore((s) => s.viewpointsStatus)
  const error = useViewFinderStore((s) => s.viewpointsError)
  const count = useViewFinderStore((s) => s.viewpoints.length)

  const [showLoading, setShowLoading] = useState(false)

  useEffect(() => {
    if (status !== 'loading') {
      setShowLoading(false)
      return
    }
    const timer = setTimeout(() => setShowLoading(true), LOADING_REVEAL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [status])

  if (status === 'zoomed-out') {
    return (
      <div className="vf-card status-hint status-hint--visible">Zoom in to see viewpoints and peaks</div>
    )
  }

  if (status === 'loading') {
    return (
      <div className={`vf-card status-hint status-hint--loading ${showLoading ? 'status-hint--visible' : ''}`}>
        Loading viewpoints…
        <div className="status-hint__progress" />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="vf-card status-hint status-hint--error status-hint--visible" title={error ?? undefined}>
        {friendlyMessage(error ?? '')}
      </div>
    )
  }

  if (status === 'ready' && count === 0) {
    return (
      <div className="vf-card status-hint status-hint--visible">
        No OSM-tagged viewpoints found in this area — try panning
      </div>
    )
  }

  return null
}
