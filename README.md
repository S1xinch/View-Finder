# View Finder

Find scenic, car-reachable high-elevation spots by combining terrain data with
OpenStreetMap — a desktop app for Windows and Mac, and a website that works on
mobile too.

**Try it now, no install:** https://s1xinch.github.io/View-Finder/

It surfaces "cool spots to drive to" by combining:
- Curated viewpoints already tagged in OpenStreetMap (`tourism=viewpoint`, `natural=peak`, ...)
- Computed local high points from elevation data, even where nothing is tagged
- Road-reachability filtering, so results are places you can actually drive to
- Exclusion of private/Indigenous land, using NSW's official Land Tenure data
  where available (OSM tagging as a best-effort fallback elsewhere)
- Turn-by-turn driving directions (or hand off to your phone's own maps app for real navigation)
- Live GPS location and a satellite view toggle

Everything runs on free, no-API-key data sources: [OpenFreeMap](https://openfreemap.org)
for map tiles, the public [Overpass API](https://overpass-api.de) for OSM data,
[OpenTopoData](https://www.opentopodata.org) for elevation, [OSRM](https://project-osrm.org)
for driving directions, and Esri World Imagery for the satellite layer.

## Download

Grab an installer for your platform from the [latest release](https://github.com/S1xinch/View-Finder/releases/latest) -
or just use [the website](https://s1xinch.github.io/View-Finder/), no install needed.

Neither installer is code-signed (that needs a paid developer account on both
platforms, which would break the "this app costs nothing" goal), so your OS
will warn you the first time you open it. See **Troubleshooting** below.

## Troubleshooting

**macOS: "View Finder is damaged and can't be opened. You should move it to
the Trash."**

This is macOS Gatekeeper reacting to an unsigned, downloaded app - not an
actually broken download. Fix it from Terminal:

```sh
xattr -cr /Applications/View\ Finder.app
```

(Adjust the path if you didn't install it into `/Applications`.) Then open it
normally. If you'd rather not use Terminal, right-click the app → **Open** →
**Open** in the confirmation dialog sometimes works instead, though newer
macOS versions often still require the Terminal fix above.

**Windows: SmartScreen says "Windows protected your PC"**

Same root cause (unsigned installer). Click **More info** → **Run anyway**.

**Map doesn't load / stays blank**

Make sure you're on a recent build - this was an actual bug in early
packaged builds (see commit history for the fix) where the map's rendering
worker failed silently. If it's still happening, open the in-app developer
tools (`Ctrl+Shift+I` / `Cmd+Option+I`) and check the Console tab for errors.

## Development

```sh
npm install
npm run dev         # launch the desktop app with hot reload
npm run dev:site     # launch the website locally with hot reload
npm run test:core    # unit tests for the platform-agnostic core/ logic (no Electron needed)
npm run lint
npm run build        # typecheck + production build (desktop app)
npm run build:win    # build a Windows installer (requires running on/targeting Windows tooling)
npm run build:mac    # build a macOS .dmg (requires running on macOS)
npm run build:site   # build the static website (output: dist-site/)
```

The website auto-deploys to GitHub Pages on every push to `main` that touches
its code (see `.github/workflows/deploy-site.yml`).

## Architecture

- `src/core/` — platform-agnostic data/scoring logic (no Electron, no React, no
  DOM). This boundary is enforced by an ESLint rule, which is what makes the
  website build possible: `src/site/` runs this exact same pipeline directly
  in the browser (via plain `fetch`), while `src/main/` runs it in Electron's
  main process (via `net.fetch` + a disk-backed cache). Neither duplicates the
  other's logic - see `core/services/coolSpotOrchestrator.ts`.
- `src/main/` — Electron main process: owns network access, disk cache, and IPC.
- `src/preload/` — typed `contextBridge` surface exposed to the renderer.
- `src/renderer/` — the React UI (map, panels, filters), shared unmodified
  between the desktop app and the website.
- `src/site/` — the website's entry point: wires a browser-native
  implementation of the same API the Electron preload script exposes, then
  renders `src/renderer/`'s UI as-is.
- `src/shared/` — types shared across all of the above.

See the phased build plan tracked in this repo's commit history for what's
implemented so far vs. planned.
