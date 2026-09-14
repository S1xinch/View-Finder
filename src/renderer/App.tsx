import { useEffect } from 'react'
import { MapView } from './map/MapView'
import { ViewpointLayer } from './map/ViewpointLayer'
import { PrivateLandLayer } from './map/PrivateLandLayer'
import { StatusHint } from './map/StatusHint'
import { VersionBadge } from './VersionBadge'
import { SpotListPanel } from './panels/SpotListPanel'
import { Logo } from './Logo'
import { useViewpointsSync } from './hooks/useViewpoints'
import { usePrivateLandSync } from './hooks/usePrivateLand'
import { useViewFinderStore } from './state/store'
import './styles/global.css'

export function App(): React.JSX.Element {
  const map = useViewFinderStore((s) => s.map)
  useViewpointsSync(map)
  usePrivateLandSync(map)

  // No-network sanity check for the preload/IPC bridge itself (getAppInfo
  // touches no external service), logged to the renderer console so it's
  // separable from Overpass-specific network failures.
  useEffect(() => {
    if (!window.viewFinderAPI?.getAppInfo) {
      console.error('[App] window.viewFinderAPI is unavailable at mount time')
      return
    }
    window.viewFinderAPI
      .getAppInfo()
      .then((info) => console.log('[App] getAppInfo succeeded, preload/IPC bridge is working:', info))
      .catch((error: unknown) => console.error('[App] getAppInfo failed', error))
  }, [])

  return (
    <div className="app">
      <MapView />
      <PrivateLandLayer />
      <ViewpointLayer />
      <StatusHint />
      <VersionBadge />
      <SpotListPanel />
      <div className="brand-card">
        <Logo />
        <span className="brand-card__text">
          <span className="brand-card__title">View Finder</span>
          <span className="brand-card__subtitle">Scenic high ground, reachable by car</span>
        </span>
      </div>
    </div>
  )
}
