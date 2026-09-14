interface LatLng {
  lat: number
  lng: number
}

// Builds a link to the user's own preferred navigation app, as an
// alternative to the in-app route preview (which is great for answering
// "is this genuinely reachable by car and how far is the walk-in", but
// isn't real turn-by-turn navigation - no live traffic, voice guidance,
// lane assist, etc.). Picks a URL scheme by rough platform: Apple Maps on
// iOS/Mac (the system's own Maps app, or whatever the user has set as
// their default on newer iOS/macOS versions), a generic geo: URI on
// Android (triggers Android's own app chooser among any installed maps
// apps - this is the literal "a map app of my choosing" behavior), and a
// Google Maps web URL everywhere else as a universally-supported
// fallback that works in any browser without a native app at all.
export function buildExternalMapsUrl(destination: LatLng, label?: string): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isMac = /Macintosh/.test(ua) && !isIOS
  const isAndroid = /Android/.test(ua)

  if (isIOS || isMac) {
    return `https://maps.apple.com/?daddr=${destination.lat},${destination.lng}&dirflg=d`
  }
  if (isAndroid) {
    const query = label ? `${destination.lat},${destination.lng}(${encodeURIComponent(label)})` : `${destination.lat},${destination.lng}`
    return `geo:${destination.lat},${destination.lng}?q=${query}`
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}`
}
