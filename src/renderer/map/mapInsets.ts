import type { Map as MapLibreMap } from 'maplibre-gl'

interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

// How much of the map canvas the sidebar is currently covering, per edge.
// The sidebar floats over the map as a bottom sheet (phone portrait), a
// left panel (desktop/tablet/landscape), or sits beside it with no
// overlap at all (wide desktop) - measured live rather than assumed, so
// camera moves aim at the part of the map the user can actually see.
export function sidebarInsets(map: MapLibreMap): Insets {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 }
  const sheet = document.querySelector('.sidebar')
  if (!sheet) return insets

  const s = sheet.getBoundingClientRect()
  const m = map.getContainer().getBoundingClientRect()
  const overlaps = s.width > 0 && s.height > 0 && s.left < m.right && s.right > m.left && s.top < m.bottom && s.bottom > m.top
  if (!overlaps) return insets

  // A sheet spanning most of the width is a bottom sheet; anything
  // narrower is a side panel.
  if (s.width > m.width * 0.6) insets.bottom = Math.max(0, m.bottom - s.top)
  else insets.left = Math.max(0, s.right - m.left)
  return insets
}

// fitBounds padding: the sidebar's coverage plus a margin so content isn't
// flush against its edge.
export function visiblePadding(map: MapLibreMap, margin = 40): Insets {
  const insets = sidebarInsets(map)
  return {
    top: insets.top + margin,
    right: insets.right + margin,
    bottom: insets.bottom + margin,
    left: insets.left + margin
  }
}

// flyTo/easeTo offset that lands the target in the middle of the visible
// area instead of the canvas center.
export function visibleCenterOffset(map: MapLibreMap): [number, number] {
  const { top, right, bottom, left } = sidebarInsets(map)
  return [(left - right) / 2, (top - bottom) / 2]
}
