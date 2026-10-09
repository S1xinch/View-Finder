// View Finder service worker (website only - registered from src/site/main.tsx).
//
// - The app itself: network first, so a deploy shows up straight away, with
//   the last copy kept for when there's no reception.
// - Map style, sprites and fonts: the same, kept in the map cache.
// - Vector tiles: straight from the network; offline, the copy saved by
//   "Save this area for offline" or the current drive (src/renderer/utils/
//   offlineArea.ts). Saved
//   tiles are keyed by z/x/y only, so OpenFreeMap's weekly data version in
//   the URL can't strand them.
//
// Keep MAP_CACHE, DRIVE_CACHE and offlineTileKey in sync with offlineArea.ts.
const SHELL_CACHE = 'vf-shell-v1'
const MAP_CACHE = 'vf-map-v1'
// Tiles along the current drive, saved automatically and deleted when the
// drive ends (src/renderer/hooks/useOfflineDrive.ts).
const DRIVE_CACHE = 'vf-drive-v1'
const TILE_RE = /^https:\/\/tiles\.openfreemap\.org\/planet\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.pbf$/

const offlineTileKey = (z, x, y) => `https://vf-offline.invalid/tiles/${z}/${x}/${y}.pbf`

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  const tile = request.url.match(TILE_RE)
  if (tile) {
    // No network, or a bad answer (patchy reception, captive portal): use
    // the saved copy if there is one.
    const key = offlineTileKey(tile[1], tile[2], tile[3])
    const saved = async () => (await (await caches.open(MAP_CACHE)).match(key)) || (await caches.open(DRIVE_CACHE)).match(key)
    event.respondWith(
      fetch(request)
        .then(async (response) => (response.ok ? response : (await saved()) || response))
        .catch(async () => (await saved()) || Response.error())
    )
    return
  }

  if (url.origin === self.location.origin) event.respondWith(networkFirst(request, SHELL_CACHE))
  // natural_earth is the low-zoom hillshade raster - not worth keeping.
  else if (url.hostname === 'tiles.openfreemap.org' && !url.pathname.startsWith('/natural_earth/')) {
    event.respondWith(networkFirst(request, MAP_CACHE))
  }
})

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    // ponytail: old hashed app assets stay in the shell cache after a deploy;
    // a few hundred KB each, prune by name if it ever matters.
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw error
  }
}
