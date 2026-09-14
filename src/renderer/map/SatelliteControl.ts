import type { IControl } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'

// Same plain-IControl approach as LocateControl.ts - lives in the same
// bottom-right control stack as the zoom/locate buttons and inherits the
// restyled .maplibregl-ctrl-group look.
export class SatelliteControl implements IControl {
  private container: HTMLDivElement | null = null
  private unsubscribe: (() => void) | null = null

  onAdd(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group satellite-ctrl'

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'satellite-ctrl__button'
    button.setAttribute('aria-label', 'Toggle satellite view')
    button.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Z" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15.5 0 18M12 3c-2.5 2.5-2.5 15.5 0 18" stroke="currentColor" stroke-width="1.4"/></svg>'
    button.addEventListener('click', () => {
      useViewFinderStore.getState().toggleSatelliteView()
    })

    const applyActiveState = (): void => {
      const satelliteView = useViewFinderStore.getState().satelliteView
      button.classList.toggle('satellite-ctrl__button--active', satelliteView)
    }
    applyActiveState()
    this.unsubscribe = useViewFinderStore.subscribe(applyActiveState)

    container.appendChild(button)
    this.container = container
    return container
  }

  onRemove(): void {
    this.unsubscribe?.()
    this.container?.remove()
    this.container = null
  }
}
