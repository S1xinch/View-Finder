interface LatLng {
  lat: number
  lng: number
}

export interface MapsAppLink {
  label: string
  href: string
  // https links open in a new tab, or straight into the app via its
  // universal link; a custom scheme (om://) is followed in place, since a
  // new tab for it would just be left blank.
  newTab: boolean
}

function isPhone(): boolean {
  if (typeof navigator === 'undefined') return false
  const iPadAsMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || iPadAsMac
}

// The "Open in…" choices for handing a spot to a dedicated navigation app.
// Organic Maps is offered on phones only (it's a mobile app). It routes on
// the same OpenStreetMap roads View Finder does, so it knows back roads and
// fire trails Apple and Google often don't, and it runs on CarPlay. Its route
// link needs an explicit start, in a fixed parameter order (see
// libs/map/mwm_url.cpp in organicmaps/organicmaps), so without a known
// location it opens on the pin instead, one tap from routing there.
export function buildMapsAppLinks(destination: LatLng, label?: string, from?: LatLng | null): MapsAppLink[] {
  const dest = `${destination.lat},${destination.lng}`
  const name = encodeURIComponent(label ?? '')
  const links: MapsAppLink[] = [
    { label: 'Apple Maps', href: `https://maps.apple.com/?daddr=${dest}&dirflg=d`, newTab: true },
    {
      label: 'Google Maps',
      href: `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`,
      newTab: true
    }
  ]
  if (isPhone()) {
    links.push({
      label: 'Organic Maps',
      href: from
        ? `om://route?sll=${from.lat},${from.lng}&saddr=&dll=${dest}&daddr=${name}&type=vehicle`
        : `om://map?ll=${dest}&n=${name}`,
      newTab: false
    })
  }
  return links
}
