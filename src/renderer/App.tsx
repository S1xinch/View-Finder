import { MapView } from './map/MapView'
import { ViewpointLayer } from './map/ViewpointLayer'
import { ZoomHint } from './map/ZoomHint'
import './styles/global.css'

export function App(): React.JSX.Element {
  return (
    <div className="app">
      <MapView />
      <ViewpointLayer />
      <ZoomHint />
      <div className="brand-card">
        <span className="brand-card__title">View Finder</span>
        <span className="brand-card__subtitle">Scenic high ground, reachable by car</span>
      </div>
    </div>
  )
}
