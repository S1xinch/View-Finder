import { useViewFinderStore } from '../state/store'

export function StatusHint(): React.JSX.Element | null {
  const status = useViewFinderStore((s) => s.viewpointsStatus)
  const error = useViewFinderStore((s) => s.viewpointsError)

  if (status === 'zoomed-out') {
    return <div className="vf-card status-hint">Zoom in to see viewpoints and peaks</div>
  }

  if (status === 'loading') {
    return <div className="vf-card status-hint">Loading viewpoints…</div>
  }

  if (status === 'error') {
    return (
      <div className="vf-card status-hint status-hint--error">
        Couldn&apos;t load viewpoints{error ? `: ${error}` : ''}
      </div>
    )
  }

  return null
}
