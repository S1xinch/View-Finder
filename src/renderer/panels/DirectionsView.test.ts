import { describe, expect, it } from 'vitest'
import {
  advancePassedStepIndex,
  estimateMinutesRemaining,
  haversineDistanceMeters,
  MANEUVER_ARRIVAL_METERS
} from './DirectionsView'
import { selectActiveRoute, useViewFinderStore } from '../state/store'
import type { RouteResult, RouteStep, Viewpoint } from '@shared/ipcContract'

function route(distanceMeters: number, durationSeconds: number, legs: number[]): RouteResult {
  return {
    coordinates: [],
    distanceMeters,
    durationSeconds,
    steps: legs.map((d, i) => ({ instruction: '', distanceMeters: d, type: i === 0 ? 'depart' : 'turn', location: [0, i] }))
  }
}

describe('estimateMinutesRemaining', () => {
  // 50 km in 40 min: the old flat 15 km/h guess said 200 min here.
  const drive = route(50_000, 2400, [10_000, 20_000, 20_000, 0])

  it("matches OSRM's own duration at the start of the drive", () => {
    expect(estimateMinutesRemaining(drive, 0, null)).toBe(40)
  })

  it('scales down by the distance left, including the leg being driven', () => {
    // Passed the first turn, a quarter of the way-as-the-crow-flies from the
    // next one: a quarter of that 20 km leg + the last 20 km = 25 km left.
    const straightToNext = haversineDistanceMeters([0, 1], [0, 2])
    expect(estimateMinutesRemaining(drive, 1, straightToNext / 4)).toBe(20)
  })

  it('counts a winding leg by road distance, not the straight-line gap', () => {
    // Standing at the start of the leg: the whole 10 km of road is still
    // ahead even though the next turn is ~111 km away in a straight line
    // in this synthetic route (and far closer on a real winding one).
    const straightToNext = haversineDistanceMeters([0, 0], [0, 1])
    expect(estimateMinutesRemaining(drive, 0, straightToNext)).toBe(40)
  })

  it('returns null once only the arrival step is left', () => {
    expect(estimateMinutesRemaining(drive, 3, null)).toBeNull()
  })
})

describe('selectActiveRoute', () => {
  const primary = route(10_000, 600, [10_000, 0])
  const alternative = route(12_000, 700, [12_000, 0])
  const withAlt = { ...primary, alternatives: [alternative] }

  it('is the primary route by default and the chosen alternative otherwise', () => {
    expect(selectActiveRoute({ route: withAlt, routeChoice: 0 })).toBe(withAlt)
    expect(selectActiveRoute({ route: withAlt, routeChoice: 1 })).toBe(alternative)
  })

  it('falls back to the primary route for an out-of-range choice', () => {
    expect(selectActiveRoute({ route: withAlt, routeChoice: 5 })).toBe(withAlt)
  })
})

describe('requestRoute', () => {
  it('counts every request, even to the same spot, so it refetches', () => {
    const spot: Viewpoint = { id: 'a', lat: 0, lng: 0, category: 'viewpoint', tags: {} }
    const before = useViewFinderStore.getState().routeRequestNonce
    useViewFinderStore.getState().requestRoute(spot)
    useViewFinderStore.getState().requestRoute(spot)
    expect(useViewFinderStore.getState().routeRequestNonce).toBe(before + 2)
    expect(useViewFinderStore.getState().routeChoice).toBe(0)
  })
})

function step(lng: number, lat: number): RouteStep {
  return { instruction: '', distanceMeters: 0, type: 'turn', location: [lng, lat] }
}

// A 4-step route: depart (0), two turns (1, 2), arrive (3) - each maneuver
// location a known distance apart so the arrival threshold can be tested
// precisely against it.
const STEPS: RouteStep[] = [step(0, 0), step(0, 0.001), step(0, 0.002), step(0, 0.003)]

describe('haversineDistanceMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineDistanceMeters([0, 0], [0, 0])).toBe(0)
  })

  it('matches a known short distance within rounding error', () => {
    // ~0.001 degrees of latitude is about 111 meters.
    const meters = haversineDistanceMeters([0, 0], [0, 0.001])
    expect(meters).toBeGreaterThan(100)
    expect(meters).toBeLessThan(120)
  })
})

describe('advancePassedStepIndex', () => {
  it('stays put when far from the next maneuver', () => {
    // STEPS[1] is ~111m away - well outside MANEUVER_ARRIVAL_METERS (25m).
    expect(advancePassedStepIndex(0, [0, 0], STEPS)).toBe(0)
  })

  it('advances once within the arrival threshold of the next maneuver', () => {
    const here: [number, number] = STEPS[1].location
    expect(advancePassedStepIndex(0, here, STEPS)).toBe(1)
  })

  it('never advances onto the final (arrive) step - nothing is "upcoming" after it', () => {
    // Standing right at STEPS[2]'s location (the last real turn before
    // arrive) should advance to 2, not 3.
    const here: [number, number] = STEPS[2].location
    expect(advancePassedStepIndex(1, here, STEPS)).toBe(2)
    expect(advancePassedStepIndex(2, here, STEPS)).toBe(2)
  })

  it('catches up through multiple already-passed maneuvers in one call', () => {
    // Simulates a GPS gap: last known index was 0, but the driver is now
    // right at the second turn's location - should skip straight to 2, not
    // get stuck re-checking index 1 forever.
    const here: [number, number] = STEPS[2].location
    expect(advancePassedStepIndex(0, here, STEPS)).toBe(2)
  })

  it('never regresses below the given prev index', () => {
    // Standing back at the start shouldn't undo previous progress.
    expect(advancePassedStepIndex(2, [0, 0], STEPS)).toBe(2)
  })

  it(`treats a point just outside ${MANEUVER_ARRIVAL_METERS}m as not yet arrived`, () => {
    // ~0.0003 degrees of latitude is roughly 33m - outside the 25m threshold.
    const justOutside: [number, number] = [0, 0.0003]
    expect(advancePassedStepIndex(0, justOutside, STEPS)).toBe(0)
  })
})
