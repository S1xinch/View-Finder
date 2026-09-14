import { useEffect, useState } from 'react'
import { useViewFinderStore } from '../state/store'
import { MIN_ZOOM_FOR_VIEWPOINTS } from '../hooks/useViewpoints'

export function ZoomHint(): React.JSX.Element | null {
  const map = useViewFinderStore((s) => s.map)
  const [zoom, setZoom] = useState<number | null>(null)

  useEffect(() => {
    if (!map) return

    const updateZoom = (): void => setZoom(map.getZoom())
    updateZoom()
    map.on('zoom', updateZoom)
    return () => {
      map.off('zoom', updateZoom)
    }
  }, [map])

  if (zoom === null || zoom >= MIN_ZOOM_FOR_VIEWPOINTS) return null

  return (
    <div className="vf-card zoom-hint">
      Zoom in to see viewpoints and peaks
    </div>
  )
}
