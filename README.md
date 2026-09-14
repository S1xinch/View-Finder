# View Finder

Find scenic, car-reachable high-elevation spots by combining terrain data with
OpenStreetMap — a desktop app for Windows and Mac (built to keep porting to
phone later realistic).

It surfaces "cool spots to drive to" by combining:
- Curated viewpoints already tagged in OpenStreetMap (`tourism=viewpoint`, `natural=peak`, ...)
- Computed local high points from elevation data, even where nothing is tagged
- Road-reachability filtering, so results are places you can actually drive to
- Exclusion of farmland/private-access land (best-effort, based on OSM tagging)

Everything runs on free, no-API-key data sources: [OpenFreeMap](https://openfreemap.org)
for map tiles, the public [Overpass API](https://overpass-api.de) for OSM data, and
[OpenTopoData](https://www.opentopodata.org) for elevation.

## Development

```sh
npm install
npm run dev        # launch the app with hot reload
npm run test:core  # unit tests for the platform-agnostic core/ logic (no Electron needed)
npm run lint
npm run build       # typecheck + production build
npm run build:win   # build a Windows installer (requires running on/targeting Windows tooling)
npm run build:mac   # build a macOS .dmg (requires running on macOS)
```

## Architecture

- `src/core/` — platform-agnostic data/scoring logic (no Electron, no React). This
  boundary is enforced by an ESLint rule so the logic stays portable to a future
  mobile app.
- `src/main/` — Electron main process: owns network access, disk cache, and IPC.
- `src/preload/` — typed `contextBridge` surface exposed to the renderer.
- `src/renderer/` — the React UI (map, panels, filters).
- `src/shared/` — types shared across the above.

See the phased build plan tracked in this repo's commit history for what's
implemented so far vs. planned.
