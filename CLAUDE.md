# View Finder — project brief for Claude

This file is for a Claude Code session picking up work on this repo cold.
User-facing info and the architecture layer diagram already live in
`README.md` — read that first for what the app is and does. This file is
about *how development on this repo actually happens*: the shipping
workflow, hard-won lessons, and where things currently stand.

## Who's driving

Development so far has been almost entirely a single long-running Claude
Code session iterating directly with the app's owner (a non-developer)
based on their live testing feedback — bug reports like "the pins don't
load sometimes" or "the button is in the top left", not spec'd-out
tickets. Expect the same style: investigate from a plain-language report,
find the real root cause (several bugs here turned out to be genuine
timing/race conditions, not what the report literally described), fix it,
ship it, and explain what happened in plain terms afterward.

## Shipping workflow (this is the important part)

There's a long-lived development branch, **`claude/app-development-lhnwi3`**.
The established, repeatedly-confirmed pattern for every change:

1. Work on `claude/app-development-lhnwi3` directly (create it from
   `origin/main` if it doesn't exist locally).
2. Validate before committing (see **Validation gate** below).
3. Commit and push to `claude/app-development-lhnwi3`.
4. `git fetch origin main`, create a **fresh branch off `origin/main`**
   (not off the dev branch), and `git cherry-pick` the commit onto it.
5. Validate again on that fresh branch.
6. Push, open a **draft PR** against `main`, mark it ready, and **merge it
   yourself (squash)** — this has been done autonomously every round
   without re-asking each time. Immediately `subscribe_pr_activity` on any
   PR you open.
7. Delete the temporary release branch locally, switch back to
   `claude/app-development-lhnwi3`.
8. The website auto-deploys via `.github/workflows/deploy-site.yml` on
   every push to `main` that touches relevant paths — no manual step
   needed, but it's worth confirming the run actually succeeded (a
   `send_later` check-in 1-2 minutes out works well for this, since the
   workflow only takes about 30-45s).

Why cherry-pick to a fresh branch instead of just PR-ing the dev branch
directly: `claude/app-development-lhnwi3` is a long-lived integration
branch that accumulates work over many turns/sessions, and its own
`package.json` version is deliberately left unbumped between releases —
PR-ing it directly would drag in unrelated history and version noise. The
cherry-pick keeps each PR to exactly one focused change against a clean,
current `main`.

## Validation gate

Before every commit:
- `npm run lint`
- `npm run test:core` (currently 79 tests, no Electron needed)
- `npm run build:site` (type-checks + builds the website)
- **`npm run build`** (the full desktop build: main + preload + renderer)
  — only strictly required when a change touches `src/main/`,
  `src/preload/`, or anything shared with the desktop renderer, but it's
  cheap (a few seconds) and has caught real issues, so run it whenever in
  doubt.

There is no CI workflow that gates PRs on this repo (only `release.yml`
and `deploy-site.yml`, both triggered by tag-push/merge-to-main, not by
opening a PR) — the local validation gate above *is* the check.

## Desktop releases (separate from the website deploy)

The website and the desktop app ship independently:
- Website: auto-deploys on every relevant push to `main`, always current.
- Desktop: only updates when someone explicitly cuts a release — bump
  `package.json`'s version in its own small PR ("Bump version to X.Y.Z
  for a fresh desktop release build"), merge it, then trigger
  `.github/workflows/release.yml` via `mcp__github__actions_run_trigger`
  (`run_workflow`, `ref: main`) rather than pushing a git tag directly —
  **pushing a tag from this sandbox has failed with an HTTP 403** in this
  session (likely a git-proxy permission gap); the workflow's own
  `workflow_dispatch` path works fine and lets `softprops/action-gh-release`
  create the tag itself. This builds Windows/Mac installers on real
  GitHub-hosted runners and publishes them as a GitHub Release (always
  `prerelease: true` by design — see the workflow's own comments).
- **Check whether `main` has drifted ahead of the last cut release**
  before assuming the desktop installers are current — e.g. as of this
  writing `origin/main` is 9 commits ahead of the `v1.0.3` tag (mobile
  bottom-sheet work, the GPU marker-layer rewrite, and a real map
  race-condition fix have all shipped to the website but not into a
  desktop installer yet). Compare with `git log v<latest-tag>..origin/main`.

## Hard-won lessons (don't rediscover these)

- **MapLibre's `isStyleLoaded()` is not a one-time "has it loaded" flag.**
  It also reflects whether the *currently visible* tiles have finished
  loading, so it routinely goes `false` again during ordinary panning —
  long after the map's `'load'` event already fired (a strictly one-time
  event). Code that did `if (isStyleLoaded()) X(); else map.once('load', X)`
  on every data update could silently and permanently drop that update if
  it landed in one of those windows (this was the actual cause of "the
  pins don't load sometimes"). Fixed by only exposing the `map` instance
  to the rest of the app (via the zustand store) once its style has
  genuinely finished loading for the first time — every consumer can then
  safely add sources/layers immediately, no per-component guard needed.
  See `MapView.tsx`'s `markMapReady`.
- **Viewpoint pins render as a GPU `symbol` layer, not DOM `Marker`s.**
  DOM markers need a synchronous main-thread style write to reposition on
  *every* pan/zoom frame — fine for one marker (see `LocationLayer.tsx`,
  which intentionally stays DOM-based for its single GPS dot, since that
  gets it a free CSS pulse animation), a real problem for potentially
  hundreds of viewpoints. `ViewpointLayer.tsx` rasterizes one icon per
  category onto a canvas, registers it via `map.addImage`, and renders
  all pins from one GeoJSON source + symbol layer instead.
- **Mobile Safari/PWA quirks, each cost a real debugging round:**
  the mobile CSS breakpoint must be `(max-width: 600px), (max-height: 500px) and (orientation: landscape)` —
  width alone misses a phone turned sideways entirely, since its short
  edge becomes the *height*. An "Add to Home Screen" installed PWA
  renders zoomed-in relative to the same page in a normal Safari tab
  unless the viewport meta pins `maximum-scale=1.0, user-scalable=no`.
  And a touch-driven toggle button needs `setPointerCapture` + acting
  directly on `pointerup` rather than a drag-distance threshold with a
  `click`-event fallback — `touch-action: none` (needed so the drag
  doesn't also pan the map underneath) can suppress the synthetic click
  a threshold-miss was relying on, silently breaking plain taps.
- **Overpass reliability**: a per-endpoint concurrency gate
  (`overpassClient.ts`'s `EndpointGate`, max 2 concurrent per endpoint)
  and treating a response's `remark` field (Overpass's own "I timed out,
  here's partial/empty data" signal) as a failure rather than a real empty
  result were both needed — the latter was silently caching genuine "0
  results" for up to 30 days for areas that actually have viewpoints.
  IndexedDB (the website's on-disk cache) is *not* cleared by a normal
  page refresh, only by "Clear site data" or a private window — worth
  knowing before chasing a "the fix didn't work" report that's actually
  just a stale cache entry from before the fix shipped.
- **`@turf/turf`'s barrel import already tree-shakes correctly** — a real
  side-by-side build comparison confirmed switching to scoped
  per-function packages (`@turf/boolean-point-in-polygon` etc.) made zero
  difference to bundle size. Don't redo that experiment.

## Current state (as of this writing)

- `package.json` version on `main`: `1.0.3`. Dev branch
  (`claude/app-development-lhnwi3`) intentionally stays unbumped between
  releases.
- Latest cut desktop release: `v1.0.3` — but see **Desktop releases**
  above, `main` has since moved on meaningfully.
- Website: always current with `main`, live at
  https://s1xinch.github.io/View-Finder/.
- No open PRs, no known outstanding bugs at the time this file was
  written — check `mcp__github__list_pull_requests` and recent
  conversation history for anything since.

## Everything else

Architecture, the data pipeline, local dev commands, and troubleshooting
docs for end users all live in `README.md` — this file is deliberately
just the operational/historical knowledge that isn't obvious from reading
the code fresh.
