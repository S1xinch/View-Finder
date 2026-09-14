export function VersionBadge(): React.JSX.Element {
  // Checked at render time, not module-load time - on the website
  // (src/site/main.tsx), window.viewFinderAPI isn't assigned until that
  // entry file's own top-level code runs, which happens *after* this
  // module is evaluated (ES modules execute their imports, this one
  // included via App.tsx's import graph, before the importing file's own
  // body). A module-level check here would see `undefined` and always
  // read "MISSING" on the website even though the API works fine by the
  // time anything actually calls it. Electron's preload script already
  // sets window.viewFinderAPI before any renderer module runs at all, so
  // this behaves the same there either way.
  const apiAvailable = typeof window !== 'undefined' && typeof window.viewFinderAPI?.getViewpoints === 'function'
  return (
    <div className="version-badge">
      v{__APP_VERSION__} · {__GIT_COMMIT__} · API: {apiAvailable ? 'ok' : 'MISSING'}
    </div>
  )
}
