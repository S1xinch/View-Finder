import { app, net } from 'electron'
import { join } from 'node:path'
import { createCoolSpotOrchestrator } from '@core/services/coolSpotOrchestrator'
import { MemoryCacheStore } from '@core/cache/MemoryCacheStore'
import { DiskCacheStore } from '@core/cache/DiskCacheStore'
import { TieredCacheStore } from '@core/cache/TieredCacheStore'
import type { CacheStore } from '@core/cache/CacheStore'

// Confirmed by a real ConnectTimeoutError from a user's machine: Node's
// plain fetch (undici) genuinely cannot reach overpass-api.de directly on
// some networks/VPNs, while net.fetch (Chromium's network stack, same path
// the renderer's already-working map tile requests use) does connect. So
// net.fetch is needed for connectivity; the Accept/User-Agent headers in
// overpassClient.ts are needed on top of that to avoid a 406 from
// Overpass's front end, which net.fetch's browser-style request triggered
// without them.
const fetchImpl = net.fetch.bind(net)

// In-memory for same-session repeat pans (no disk I/O at all), backed by a
// disk-backed store keyed under Electron's userData dir so the same
// benefit carries across app restarts too - panning back to an area you
// already visited last time you had the app open is then an instant local
// read instead of a fresh Overpass/OpenTopoData round trip.
const cache: CacheStore = new TieredCacheStore(new MemoryCacheStore(), new DiskCacheStore(join(app.getPath('userData'), 'cache')))

// The actual pipeline logic (tiling, merging, scoring, caching) lives in
// core/services/coolSpotOrchestrator.ts so it's shared verbatim with the
// browser build (src/site/) rather than duplicated - this file just wires
// in the Electron-specific network/cache implementations.
const orchestrator = createCoolSpotOrchestrator({ fetchImpl, cache })

export const { getViewpoints, getExcludedLand } = orchestrator
