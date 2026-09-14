import type { IControl } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'

// A plain MapLibre IControl (not a React component) so it sits inside the
// map's own bottom-right control stack next to the zoom buttons and
// inherits the same restyled .maplibregl-ctrl-group look - a React overlay
// positioned to match by hand would drift out of sync with that CSS.
export class LocateControl implements IControl {
  private container: HTMLDivElement | null = null
  private unsubscribe: (() => void) | null = null

  onAdd(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group locate-ctrl'

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'locate-ctrl__button'
    button.setAttribute('aria-label', 'Show my location')
    button.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="3.5" fill="currentColor"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    button.addEventListener('click', () => {
      useViewFinderStore.getState().toggleLocationTracking()
    })

    const applyActiveState = (): void => {
      const tracking = useViewFinderStore.getState().locationTracking
      button.classList.toggle('locate-ctrl__button--active', tracking)
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
