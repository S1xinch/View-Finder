import { useEffect } from 'react'
import { MapView } from './map/MapView'
import { ViewpointLayer } from './map/ViewpointLayer'
import { PrivateLandLayer } from './map/PrivateLandLayer'
import { LocationLayer } from './map/LocationLayer'
import { RouteLayer } from './map/RouteLayer'
import { VersionBadge } from './VersionBadge'
import { Sidebar } from './panels/Sidebar'
import { useViewpointsSync } from './hooks/useViewpoints'
import { usePrivateLandSync } from './hooks/usePrivateLand'
import { useGeolocation } from './hooks/useGeolocation'
import { useRoute } from './hooks/useRoute'
import { useViewFinderStore } from './state/store'
import { applyThemeToDocument } from './themes'
import './styles/global.css'

export function App(): React.JSX.Element {
  const map = useViewFinderStore((s) => s.map)
  const theme = useViewFinderStore((s) => s.theme)
  useViewpointsSync(map)
  usePrivateLandSync(map)
  useGeolocation()
  useRoute()

  useEffect(() => applyThemeToDocument(theme), [theme])

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
      {/* Mounted after RouteLayer so its symbol layer (see ViewpointLayer.tsx
          - a GPU-rendered canvas layer, not DOM markers) draws on top of the
          route line rather than under it - layer add order is z-order for
          two canvas-rendered layers, unlike the DOM markers this replaced,
          which always sat above every canvas layer regardless of mount
          order. */}
      <RouteLayer />
      <ViewpointLayer />
      <LocationLayer />
      <Sidebar />
      <VersionBadge />
    </div>
  )
}
