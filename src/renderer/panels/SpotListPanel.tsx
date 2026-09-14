import { useMemo } from 'react'
import { useViewFinderStore } from '../state/store'
import { CATEGORY_COLOR, CATEGORY_LABEL } from '../map/categoryStyle'
import type { Viewpoint } from '@shared/ipcContract'

function passesFilters(vp: Viewpoint, minElevationMeters: number, maxDistanceToRoadMeters: number): boolean {
  if ((vp.elevationMeters ?? 0) < minElevationMeters) return false
  const distance = vp.distanceToRoadMeters
  // Unknown distance (no road data) is never excluded here - matches the
  // permissive treatment already applied server-side in
  // roadReachability.ts, for the same reason: missing data isn't evidence
  // of unreachability.
  if (distance != null && distance > maxDistanceToRoadMeters) return false
  return true
}

function formatDistance(meters: number | null | undefined): string {
  if (meters == null) return 'distance to road unknown'
  if (meters < 30) return 'right on a road'
  return `${Math.round(meters)} m from road`
}

export function SpotListPanel(): React.JSX.Element | null {
  const map = useViewFinderStore((s) => s.map)
  const viewpoints = useViewFinderStore((s) => s.viewpoints)
  const status = useViewFinderStore((s) => s.viewpointsStatus)
  const filters = useViewFinderStore((s) => s.filters)
  const setMinElevationMeters = useViewFinderStore((s) => s.setMinElevationMeters)
  const setMaxDistanceToRoadMeters = useViewFinderStore((s) => s.setMaxDistanceToRoadMeters)
  const listPanelOpen = useViewFinderStore((s) => s.listPanelOpen)
  const toggleListPanel = useViewFinderStore((s) => s.toggleListPanel)
  const showPrivateLand = useViewFinderStore((s) => s.showPrivateLand)
  const togglePrivateLand = useViewFinderStore((s) => s.togglePrivateLand)

  const filtered = useMemo(
    () => viewpoints.filter((vp) => passesFilters(vp, filters.minElevationMeters, filters.maxDistanceToRoadMeters)),
    [viewpoints, filters]
  )

  if (status !== 'ready' || viewpoints.length === 0) return null

  const flyTo = (vp: Viewpoint): void => {
    map?.flyTo({ center: [vp.lng, vp.lat], zoom: Math.max(map.getZoom(), 14), duration: 800 })
  }

  return (
    <div className="spot-list">
      <button type="button" className="spot-list__toggle" onClick={toggleListPanel}>
        {filtered.length} cool spot{filtered.length === 1 ? '' : 's'} {listPanelOpen ? '▲' : '▼'}
      </button>

      {listPanelOpen && (
        <div className="vf-card spot-list__panel">
          <div className="spot-list__filters">
            <label className="spot-list__filter">
              <span>Min elevation: {filters.minElevationMeters} m</span>
              <input
                type="range"
                min={0}
                max={4000}
                step={50}
                value={filters.minElevationMeters}
                onChange={(e) => setMinElevationMeters(Number(e.target.value))}
              />
            </label>
            <label className="spot-list__filter">
              <span>Max distance to road: {filters.maxDistanceToRoadMeters} m</span>
              <input
                type="range"
                min={0}
                max={500}
                step={25}
                value={filters.maxDistanceToRoadMeters}
                onChange={(e) => setMaxDistanceToRoadMeters(Number(e.target.value))}
              />
            </label>
            <label className="spot-list__checkbox">
              <input type="checkbox" checked={showPrivateLand} onChange={togglePrivateLand} />
              <span>Show private/farmland</span>
            </label>
          </div>

          <div className="spot-list__rows">
            {filtered.length === 0 && <div className="spot-list__empty">No spots match these filters</div>}
            {filtered.map((vp) => (
              <button type="button" key={vp.id} className="spot-list__row" onClick={() => flyTo(vp)}>
                <span className="spot-list__dot" style={{ backgroundColor: CATEGORY_COLOR[vp.category] }} />
                <span className="spot-list__row-text">
                  <span className="spot-list__row-name">{vp.name ?? CATEGORY_LABEL[vp.category]}</span>
                  <span className="spot-list__row-detail">
                    {vp.elevationMeters != null ? `${Math.round(vp.elevationMeters)} m` : 'elevation unknown'} ·{' '}
                    {formatDistance(vp.distanceToRoadMeters)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
