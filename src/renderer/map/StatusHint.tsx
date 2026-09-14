import { useViewFinderStore } from '../state/store'

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

  if (status === 'zoomed-out') {
    return <div className="vf-card status-hint">Zoom in to see viewpoints and peaks</div>
  }

  if (status === 'loading') {
    return <div className="vf-card status-hint">Loading viewpoints…</div>
  }

  if (status === 'error') {
    return (
      <div className="vf-card status-hint status-hint--error" title={error ?? undefined}>
        {friendlyMessage(error ?? '')}
      </div>
    )
  }

  if (status === 'ready' && count === 0) {
    return <div className="vf-card status-hint">No OSM-tagged viewpoints found in this area — try panning</div>
  }

  return null
}
