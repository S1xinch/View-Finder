# Graph Report - View-Finder  (2026-09-15)

## Corpus Check
- Corpus is ~31,169 words - fits in a single context window. You may not need a graph.

## Summary
- 430 nodes · 799 edges · 20 communities (16 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Test Utilities
- Module Group 1
- Electron Bridge
- API Layer
- Electron Bridge
- State Management
- Configuration
- Configuration
- Module Group 8
- Configuration
- Electron Bridge
- Electron Bridge
- API Layer
- State Management
- Module Group 14
- Module Group 15
- Configuration
- Module Group 18
- Module Group 19

## God Nodes (most connected - your core abstractions)
1. `useViewFinderStore` - 29 edges
2. `createCoolSpotOrchestrator()` - 26 edges
3. `vitest` - 18 edges
4. `compilerOptions` - 16 edges
5. `compilerOptions` - 16 edges
6. `react` - 15 edges
7. `compilerOptions` - 15 edges
8. `maplibre-gl` - 12 edges
9. `CacheStore` - 12 edges
10. `Viewpoint` - 11 edges

## Surprising Connections (you probably didn't know these)
- `CoolSpotOrchestratorDeps` --references--> `CacheStore`  [EXTRACTED]
  src/core/services/coolSpotOrchestrator.ts → src/core/cache/CacheStore.ts
- `createCoolSpotOrchestrator()` --calls--> `findLocalMaxima()`  [EXTRACTED]
  src/core/services/coolSpotOrchestrator.ts → src/core/elevation/prominence.ts
- `getComputedPeaks()` --calls--> `findLocalMaxima()`  [EXTRACTED]
  src/core/services/coolSpotOrchestrator.ts → src/core/elevation/prominence.ts
- `ScoredViewpoint` --inherits--> `Viewpoint`  [EXTRACTED]
  src/core/scoring/coolSpotScore.ts → src/core/osm/types.ts
- `createCoolSpotOrchestrator()` --calls--> `mergeCandidates()`  [EXTRACTED]
  src/core/services/coolSpotOrchestrator.ts → src/core/scoring/candidateBuilder.ts

## Import Cycles
- None detected.

## Communities (20 total, 3 thin omitted)

### Community 0 - "Test Utilities"
Cohesion: 0.07
Nodes (52): @turf/turf, vitest, queryElevations(), buildSampleGrid(), isPointInBBox(), snapBBoxToGrid(), splitBBox(), BBox (+44 more)

### Community 1 - "Module Group 1"
Cohesion: 0.08
Nodes (44): maplibre-gl, react, App(), useGeolocation(), usePrivateLandSync(), useRoute(), MIN_ZOOM_FOR_VIEWPOINTS, useViewpointsSync() (+36 more)

### Community 2 - "Electron Bridge"
Cohesion: 0.04
Nodes (39): buildInfo, author, dependencies, maplibre-gl, react, react-dom, @turf/turf, zustand (+31 more)

### Community 3 - "API Layer"
Cohesion: 0.08
Nodes (26): DEFAULT_OPENTOPODATA_ENDPOINT, FetchLike, MAX_LOCATIONS_PER_REQUEST, OpenTopoDataResponse, OpenTopoDataResult, findLocalMaxima(), GRID_SIZE, percentile() (+18 more)

### Community 4 - "Electron Bridge"
Cohesion: 0.13
Nodes (17): electron, IpcChannels, registerIpcHandlers(), APP_SCHEME, appUrl(), registerAppProtocolHandler(), registerAppSchemeAsPrivileged(), cache (+9 more)

### Community 5 - "State Management"
Cohesion: 0.14
Nodes (7): CacheStore, DiskCacheStore, Entry, keyToFilename(), Entry, MemoryCacheStore, TieredCacheStore

### Community 6 - "Configuration"
Cohesion: 0.10
Nodes (20): compilerOptions, baseUrl, composite, esModuleInterop, jsx, lib, module, moduleResolution (+12 more)

### Community 7 - "Configuration"
Cohesion: 0.10
Nodes (19): compilerOptions, baseUrl, composite, esModuleInterop, jsx, lib, module, moduleResolution (+11 more)

### Community 8 - "Module Group 8"
Cohesion: 0.20
Nodes (13): LocateControl, addSatelliteLayer(), applyAppleStyleTweaks(), applyDarkMapTweaks(), boostRoadContrast(), CUSTOM_LAYER_IDS, DEFAULT_VIEW, GEOLOCATED_INITIAL_ZOOM (+5 more)

### Community 9 - "Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, baseUrl, composite, esModuleInterop, lib, module, moduleResolution, noUnusedLocals (+10 more)

### Community 10 - "Electron Bridge"
Cohesion: 0.14
Nodes (14): devDependencies, electron, electron-builder, electron-vite, eslint, eslint-plugin-react-hooks, @types/react, @types/react-dom (+6 more)

### Community 11 - "Electron Bridge"
Cohesion: 0.14
Nodes (13): AppInfo, AppPlatform, BBox, ExcludedLandArea, LatLng, PlaceBoundingBox, PlaceResult, RouteResult (+5 more)

### Community 12 - "API Layer"
Cohesion: 0.20
Nodes (8): DEFAULT_NOMINATIM_ENDPOINT, FetchLike, NominatimResult, PlaceBoundingBox, PlaceResult, searchPlaces(), SearchPlacesOptions, SAMPLE_NOMINATIM_RESPONSE

### Community 13 - "State Management"
Cohesion: 0.29
Nodes (5): Entry, IndexedDbCacheStore, openDb(), orchestrator, webApi

### Community 14 - "Module Group 14"
Cohesion: 0.46
Nodes (5): haversineDistanceMeters(), metersToFeet(), computedPeakId(), mergeCandidates(), toViewpoint()

### Community 15 - "Module Group 15"
Cohesion: 0.53
Nodes (3): attemptEndpoint(), EndpointGate, gateFor()

## Knowledge Gaps
- **167 isolated node(s):** `buildInfo`, `name`, `version`, `description`, `main` (+162 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 194 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `Test Utilities` to `Electron Bridge`, `API Layer`, `State Management`, `API Layer`, `Module Group 14`?**
  _High betweenness centrality (0.337) - this node is a cross-community bridge._
- **Why does `react` connect `Module Group 1` to `Module Group 8`, `Electron Bridge`, `State Management`?**
  _High betweenness centrality (0.168) - this node is a cross-community bridge._
- **Why does `electron` connect `Electron Bridge` to `Electron Bridge`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `createCoolSpotOrchestrator()` (e.g. with `getExcludedLand()` and `getViewpoints()`) actually correct?**
  _`createCoolSpotOrchestrator()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `buildInfo`, `name`, `version` to the rest of the system?**
  _167 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Test Utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.07347915242652085 - nodes in this community are weakly interconnected._
- **Should `Module Group 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08076923076923077 - nodes in this community are weakly interconnected._