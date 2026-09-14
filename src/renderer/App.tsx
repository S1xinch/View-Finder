import { MapView } from './map/MapView'
import { ViewpointLayer } from './map/ViewpointLayer'
import './styles/global.css'

export function App(): React.JSX.Element {
  return (
    <div className="app">
      <MapView />
      <ViewpointLayer />
      <div className="brand-card">
        <span className="brand-card__title">View Finder</span>
        <span className="brand-card__subtitle">Scenic high ground, reachable by car</span>
      </div>
    </div>
  )
}
