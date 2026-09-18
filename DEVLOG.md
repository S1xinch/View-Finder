# Development Log

A running record of significant bugs, root causes, and fixes across View
Finder's development, organized by subsystem. Kept so a recurring class of
bug (there are several) doesn't get re-diagnosed from scratch. Entries are
summarized, not verbatim commit messages — see git history for full detail
and verification notes on any individual fix.

## Release pipeline & packaging

- **electron-builder auto-publish conflict.** CI failed with "GitHub
  Personal Access Token is not set" — electron-builder auto-detects CI and
  tries to publish straight to GitHub itself, conflicting with the
  workflow's own upload-artifact + release step. Fixed by setting
  `publish: null` explicitly (electron-builder's documented opt-out),
  after first learning that `publish: never` as a string is resolved as a
  *provider name* and crashes looking for a nonexistent
  `electron-publisher-never` package.
- **Release tagging on manual runs.** `softprops/action-gh-release` infers
  its tag from the triggering ref, which doesn't exist for a manual
  `workflow_dispatch` run. Fixed by reading the version from
  `package.json` and passing it as an explicit `tag_name`.
- **GitHub Pages never enabled.** First deploy failed because a repo has
  no Pages site at all until something creates one. Fixed via
  `actions/configure-pages`'s enablement option instead of a manual
  Settings toggle.
- **Packaged app: blank map.** The map failed to load only in the
  packaged (not dev-mode) build — traced through two separate causes
  before being fully fixed: first a missing shared chunk, then the actual
  root cause underneath it. Both required loading the packaged app
  directly and reading real console errors rather than reasoning from
  source alone.

## Data reliability (Overpass, caching, tiling)

This was the single most-iterated subsystem early on — a sequence of
fixes that each solved one real, live-testing-confirmed failure mode
before the request pattern stabilized:

1. **Unstable tile boundaries.** Viewport-relative tiling meant a
   one-pixel pan produced entirely new tile bounding boxes — a 100% cache
   miss on every pan, driving constant rate-limiting. Fixed by snapping
   to a fixed, absolute-coordinate grid (like XYZ map tiles) so
   overlapping viewports share cache hits.
2. **Regression from tiling roads/land-use the same way.** Roads and
   land-use were previously one query each regardless of viewport size;
   tiling them like viewpoints multiplied one query into up to four,
   producing ~24 simultaneous requests on a single pan into new
   territory — an immediate rate-limit trigger. Fixed with
   `snapBBoxToGrid`: round the bbox to the grid without splitting it, so
   these keep the cache-hit benefit while staying one query each.
3. **Per-endpoint concurrency limits, not just total volume.** Public
   Overpass instances cap concurrent *slots* per client independently of
   total request count. A pan into new territory could still fire several
   queries at once, each racing two endpoints in parallel, exceeding the
   slot cap even though no individual query was wasteful. Fixed with a
   small per-endpoint concurrency gate — requests beyond the cap queue
   instead of firing immediately.
4. **Timed-out queries cached as real empty results.** Overpass returns
   `200 OK` with whatever partial data it gathered (often none) when it
   hits its own timeout under load — indistinguishable from a genuine
   "nothing here" by element count alone, and cached as such for up to 30
   days. Fixed by checking Overpass's own `remark` field (populated only
   when something went wrong) and treating a non-empty remark as a
   failure, not a result.
5. **A third mirror added, then reverted.** Adding `overpass.osm.ch` for
   resilience against simultaneous endpoint outages backfired: it
   returned a genuinely empty-but-valid response for a real, dense area,
   because it turned out not to have full-planet coverage — untrusted
   data that looks identical to "nothing here" is worse than not racing
   it. Reverted to the two verified endpoints, and added logging of which
   endpoint actually answered so this failure mode is diagnosable in
   seconds next time rather than several rounds of back-and-forth.
6. **Duplicate concurrent fetches for the same area.** Two independent
   callers (the private-land overlay and internal exclusion filtering)
   could both request the same land-use bbox at nearly the same instant.
   Fixed with an in-flight-fetch map so a second caller joins the first's
   pending request instead of duplicating it.
7. **Debounce tuning.** Raised from 250-300ms to 500ms, then to 1000ms
   after continued rate-limit reports — panning has to genuinely stop for
   a full second before a search fires, so a quick flick-and-recatch
   doesn't start one at all. Added a manual "Search this area" bypass and
   one automatic retry (after a 2.5s delay) for transient failures, most
   of which turned out to succeed on retry anyway.
8. **A `Promise.all` discarding good results for one bad tile.** A single
   failed tile in a multi-tile fetch discarded all of that call's
   already-succeeded tiles. Switched to `Promise.allSettled` to keep
   whichever tiles succeeded.
9. **Tiled results not trimmed back to the actual viewport.** Wider grid
   tiles (needed for caching) meant results outside the visible viewport
   were included in counts/markers. Fixed by filtering merged tile
   results through `isPointInBBox` before returning.

## Filtering & scoring correctness

- **Exclusion filtering was a permanent no-op (real-world impact).** A
  live report: NSW's own Land Tenure service correctly classified a
  coordinate as Private, but the app suggested it and someone drove out
  to it. Root cause: `landUse`/`tenureByKey` were local variables reset
  to empty on every call, populated by a fire-and-forget fetch, and the
  filtering line ran synchronously immediately after *starting* that
  fetch — before its first `await` had any chance to resolve. This was
  true on every call, not just a cold cache, despite an inline comment
  claiming otherwise. Fixed by awaiting land-use and tenure lookups
  before filtering, since both are access/safety filters, not
  quality-of-suggestion ones.
- **Same bug class, different subsystem: `distanceToRoadMeters` always
  "unknown."** Roads were deferred the same way, on the reasoning that
  road-reachability is a quality signal rather than a safety one and
  could tolerate arriving stale. In practice `scoreCandidates()` always
  scored against the still-empty `roads` array, so every viewpoint
  reported "distance to road unknown" unconditionally. Fixed by folding
  the roads fetch into the same `Promise.all` as land-use/tenure — same
  parallel latency, no longer discarded. A regression test was added;
  none had existed for this path.
- **Land-use polygon exclusion vs. NSW Land Tenure data.** Two
  independent exclusion signals exist: OSM-tagged farmland/private-access
  polygons, and NSW Government's official Land Tenure raster
  classification (Private / Crownland / Indigenous Owned / National Park
  / State Forest / etc., queried via ArcGIS `identify` since no bulk
  vector polygon query is available for this dataset). Private and
  Indigenous Owned are hard-excluded; Crownland-Leasehold is deliberately
  left in (still public land) as a softer case. A candidate with no
  tenure classification is left in rather than excluded — a missed
  exclusion is a safer failure than hiding a legitimate result.

## Map rendering

- **`isStyleLoaded()` misuse causing pins to silently vanish.**
  `isStyleLoaded()` is not a one-time "has it loaded" flag — it also
  reflects whether the *current* viewport's tiles have finished loading,
  so it routinely returns false again during ordinary panning, long after
  the map's one-time `load` event already fired. Every layer component
  gated its updates behind `isStyleLoaded() ? update() : once('load',
  update)`; an update landing in one of the transient `false` windows
  fell back to a `load` listener that, having already fired once, would
  never fire again — the update silently dropped with no error. Fixed at
  the root: the map is only exposed to the rest of the app once its style
  has genuinely finished loading for the first time, so downstream
  components no longer need (or have) their own guard.
- **MapLibre 6.x rejected a `feature-state` expression on a layout
  property.** An `icon-size` hover-grow effect used `feature-state`,
  which newer MapLibre only supports on paint properties. `addLayer()`
  threw synchronously, so the source was created but the layer never was
  — pins stopped rendering entirely for the rest of the session, a
  regression from a MapLibre version bump rather than application logic.
  Fixed by dropping the hover-grow effect (cursor-on-hover was already
  sufficient affordance).
- **Feature IDs silently coerced by the GeoJSON source, breaking popups.**
  MapLibre's GeoJSON source (backed by `geojson-vt`) requires integer
  feature IDs internally and silently replaces any non-integer ID
  (including this app's `osm:node:12345`-style string IDs) with an
  auto-generated sequential integer on read-back. Click handlers matching
  by string ID against the coerced numeric ID always failed silently.
  Fixed by carrying the real ID through GeoJSON `properties` (untouched
  by the coercion) instead of the feature's native `id` field.
- **White patches in dark map mode.** The dark-mode repaint only targeted
  explicitly enumerated source-layers (water/landcover/landuse/building);
  anything else the vector tile schema used for a land fill (park,
  protected-area, cemetery, etc.) kept its original light color. Fixed
  with a catch-all dark fill for any layer not explicitly water/building,
  instead of an enumerated list that could always miss another case.

## Mobile bottom sheet & gesture handling

The most heavily-iterated area of the UI. Recorded in more detail because
the failure modes recur in shape even as the exact bug changes.

**Early structural iterations** (each replacing the previous approach
rather than patching it): plain open/close panel, then a swipeable handle
with a tap/drag threshold, then a single shrinking card (collapsed = the
same sheet at a shorter height, not a different element) with real
overscroll-to-close. The shrinking-card model is the one that stuck.

**Recurring bug pattern #1 - stale gesture state carrying across
touches.** Multiple different-looking bugs traced back to the same root
cause: a ref (`activeSourceRef`, `startYRef`, or later a `touch-action`
CSS override) not getting reset when a gesture ended abnormally.
- A pointer sequence doesn't always end with a matching `pointerup` on a
  real touchscreen — the OS/browser can fire `pointercancel` instead (an
  edge-swipe-back gesture, multi-touch conflict, or the browser handing a
  touch off to its own native scroll, which turned out to be *routine*
  behavior on Android Chrome during ordinary scrolling, not just genuine
  interruptions). Missing `onPointerCancel` handling left stale drag
  state for the *next* touch to inherit, causing an unrelated later
  gesture to snap the sheet to an unexpected height.
- Once handled, a second layer of the same bug appeared: `cancelDrag`
  unconditionally reset the sheet's inline height/transition on every
  cancel — including the routine ones from ordinary scrolling — fighting
  the CSS transition mid-scroll and reading as "scrolling doesn't run
  smoothly." Fixed by only touching sheet style when a drag this code
  actually started is what's being cancelled.
- Much later, a fix that toggled `touch-action` dynamically mid-gesture
  (to stop the browser from also treating an in-progress touch as a
  native scroll) produced a new variant: "works once or twice, then
  stops." Root cause: changing `touch-action` synchronously mid-gesture
  is unpredictable across browsers and can silently disrupt event
  delivery *without* ever firing the `pointerup`/`pointercancel` that
  would reset it — leaving the list unscrollable after the first use.
  Reverted, and replaced with an unconditional defensive reset of
  `touch-action` at the start of every new touch, so a stuck state from
  any prior gesture can never carry forward.

**Recurring bug pattern #2 - synthetic click double-handling.** A
`<label>` wrapping a checkbox (the filter chips) makes the browser fire a
*second*, forwarded click on the checkbox for one physical tap. A
one-shot boolean guard correctly swallowed the first click but reset
itself before the forwarded second one arrived, which then fell through
and toggled the sheet closed on an ordinary filter-chip tap. Fixed by
comparing timestamps instead of a boolean — any click within a short
window of a real pointer sequence ending is swallowed, not just the
first one.

**Recurring bug pattern #3 - threshold/distance tuning masking a
measurement bug.** The overscroll-to-close gesture went through several
rounds of adjusting the overscroll-start distance and a scrollTop
tolerance before the actual bug was identified: the pull distance was
measured from the *original touch-down position*, not from where the
list actually reached its scroll top. On a long list, scrolling from the
middle up to the top already moves the finger well past any reasonable
threshold by the time scrollTop hits 0 — triggering an instant handoff
while the list is still mid-scroll, which the browser can respond to by
cancelling the gesture outright. Fixed by tracking the Y position at the
moment the list actually reaches its top and measuring the pull from
there, not the original touch-down point. (A subsequent time-based
"settle guard," modeled on a technique from a production drawer library,
was tried and later removed - see pattern #1 above, this is what
introduced the touch-action stuck-state bug.)

**Other one-off gesture bugs:**
- A drag starting *on* a result row (the overwhelmingly common case,
  since most of the visible list is buttons) never began tracking at
  all, because the pointer-down handler excluded button targets
  wholesale - copied from a different handler where that exclusion was
  necessary, but not here.
- A fast flick that traveled less than the distance threshold (the
  natural way to flick something, and often *shorter* than a deliberate
  slow drag) registered as no gesture at all. Fixed by adding a velocity
  check that commits on a fast flick regardless of total distance.
- The sheet's "open" resting height was computed via a formula
  (`window.innerHeight * 0.65`) that could disagree with the CSS actually
  rendering it (`min(65dvh, 65vh)`) as mobile browser chrome shows/hides
  mid-gesture — a released drag could snap to a taller height than the
  sheet was already showing. Fixed by measuring the sheet's real rendered
  height directly instead of re-deriving an estimate.

## Turn-by-turn navigation

- **Progress tracking got stuck.** An early version of step-progress
  tracking advanced one step at a time; a GPS gap that skipped past two
  close-together turns left it permanently stuck one step behind. Fixed
  by scanning every step ahead of the last known one and advancing to the
  furthest actually reached — caught by a unit test before shipping.
- **Depart step misread as a turn.** OSRM's `depart` step carries a
  modifier too (initial facing direction, not a turn), which was being
  rendered with a turn-arrow icon. Given a dedicated depart glyph
  instead.
- **Bearing/flyTo race on exiting navigation.** Exiting navigation eases
  the map bearing back to north, but a `flyTo` meant to center the camera
  on first GPS lock (an unrelated code path sharing the same effect)
  could still fire immediately after, and since `flyTo` doesn't touch
  bearing, it re-asserted whatever heading was still active — fighting
  the reset animation depending on write order.

## Visual design system

- **Design tokens defined but never wired to real markup.** A full
  design-system pass added CSS custom properties, a typography
  utility-class scale, and a spring-feedback button component — but the
  typography classes were never applied to any actual component, and the
  button component was never imported anywhere in the app. The net
  visible effect of that pass was much smaller than intended, since most
  of the infrastructure was never actually connected to rendered UI.
  Later fixed by applying real letter-spacing/line-height directly to the
  text classes components render, and adding a global press-feedback
  rule instead of the unused dedicated component.
- **Dark-mode shadows never updated in a later shadow-system revision.**
  When the shadow tokens moved from a single flat shadow to a layered
  system, the dark-mode override block was missed — dark mode (the
  likely default on a phone) kept rendering the old flat shadow
  indefinitely.
- **Corner-radius scale too widely spread, and inconsistently applied.**
  A 5-tier radius scale combined with roughly 15 other stray hardcoded
  radius values elsewhere in the stylesheet produced visibly mismatched
  nested corners — most noticeably a very round marker-popup container
  around buttons with a much smaller, hardcoded radius. Fixed by
  collapsing to a tighter 4-tier scale and replacing every hardcoded
  value with the matching token, so nested rounded elements read as one
  family.

## iOS PWA / mobile web platform issues

- **Zoomed-in rendering as an installed home-screen app.** Adding the
  site to an iPhone home screen runs it in a standalone WKWebView shell
  that skips the auto-fit scaling a normal Safari tab applies. Without
  `maximum-scale`/`user-scalable=no` pinned in the viewport meta, the
  installed app rendered zoomed in relative to the same URL in a browser
  tab.
- **Mobile breakpoint missed landscape orientation entirely.** The
  breakpoint was `max-width` only, which a phone in landscape doesn't
  match (its short edge becomes the height) — every mobile-only rule,
  including UI element positioning, silently reverted to desktop
  behavior on rotation. Fixed with an additional `max-height` +
  `orientation: landscape` alternative in the media query.
- **A real WebKit bug: `100dvh` resolves short in standalone mode.** On
  an installed iOS home-screen app specifically — not a plain browser
  tab — with both `viewport-fit=cover` and a translucent status bar (both
  required so page content can paint under the status bar at all),
  `100%`, `100svh`, and `100dvh` all resolve *short* by the status bar's
  own height. This left a dead gap exactly that tall at the bottom of the
  screen, over the home indicator, which looked like a stray
  background-color bug but wasn't — recoloring the page background only
  changed the gap's color, not its existence. Fixed with `100lvh`, the
  one viewport unit iOS still reports correctly in this situation, scoped
  to standalone display mode only.

## Current state

All items above are resolved as of the most recent commit on `main`. The
validation gate (lint, unit tests, site build, full desktop build) passes
cleanly. No open/known bugs at the time of writing — check recent commit
history for anything since.
