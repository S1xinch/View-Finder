const apiAvailable = typeof window !== 'undefined' && typeof window.viewFinderAPI?.getViewpoints === 'function'

export function VersionBadge(): React.JSX.Element {
  return (
    <div className="version-badge">
      v{__APP_VERSION__} · {__GIT_COMMIT__} · API: {apiAvailable ? 'ok' : 'MISSING'}
    </div>
  )
}
