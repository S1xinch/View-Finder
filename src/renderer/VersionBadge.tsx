export function VersionBadge(): React.JSX.Element {
  return (
    <div className="version-badge">
      v{__APP_VERSION__} · {__GIT_COMMIT__}
    </div>
  )
}
