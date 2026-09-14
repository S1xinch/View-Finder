import { MapView } from './map/MapView'
import { ViewpointLayer } from './map/ViewpointLayer'
import { StatusHint } from './map/StatusHint'
import { useViewpointsSync } from './hooks/useViewpoints'
import { useViewFinderStore } from './state/store'
import './styles/global.css'

export function App(): React.JSX.Element {
  const map = useViewFinderStore((s) => s.map)
  useViewpointsSync(map)

  return (
    <div className="app">
      <MapView />
      <ViewpointLayer />
      <StatusHint />
      <div className="brand-card">
        <span className="brand-card__title">View Finder</span>
        <span className="brand-card__subtitle">Scenic high ground, reachable by car</span>
      </div>
    </div>
  )
}
