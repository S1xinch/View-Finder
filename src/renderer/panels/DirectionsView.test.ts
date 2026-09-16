import { describe, expect, it } from 'vitest'
import { advancePassedStepIndex, haversineDistanceMeters, MANEUVER_ARRIVAL_METERS } from './DirectionsView'
import type { RouteStep } from '@shared/ipcContract'

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
