import { describe, expect, it } from 'vitest'
import { buildGatedCheck } from './gateReachability'
import type { Gate, RoadSegment } from '../osm/roadQueries'

// A public road along lat 0 running off the area's west edge, joined at
// node 2 to a track heading north (nodes 2-3-4) with a gate at node 3,
// ~1.1km up. 0.01 degrees is ~1.1km.
const bbox = { west: 0, south: -0.05, east: 0.05, north: 0.05 }
const publicRoad: RoadSegment = { coordinates: [[-0.01, 0], [0.01, 0]], nodeIds: [1, 2] }
const track: RoadSegment = { coordinates: [[0.01, 0], [0.01, 0.01], [0.01, 0.02]], nodeIds: [2, 3, 4], minor: true }
const gate = (closed: boolean): Gate => ({ id: 3, lat: 0.01, lng: 0.01, closed })
const beyondGate = { lat: 0.019, lng: 0.011 }

describe('buildGatedCheck', () => {
  it('flags a spot whose only nearby track is behind a closed gate', () => {
    expect(buildGatedCheck([publicRoad, track], [gate(true)], bbox)(beyondGate)).toBe(true)
  })

  it('leaves it alone when the gate is open', () => {
    expect(buildGatedCheck([publicRoad, track], [gate(false)], bbox)(beyondGate)).toBe(false)
  })

  it('leaves it alone within walking distance of the gate', () => {
    expect(buildGatedCheck([publicRoad, track], [gate(true)], bbox)({ lat: 0.0125, lng: 0.011 })).toBe(false)
  })

  it('treats a track that runs off the loaded area as connected', () => {
    const offEdge: RoadSegment = { ...track, coordinates: [[0.01, 0], [0.01, 0.01], [0.01, 0.06]] }
    expect(buildGatedCheck([publicRoad, offEdge], [gate(true)], bbox)(beyondGate)).toBe(false)
  })

  it('flags a spot whose only nearby road is private', () => {
    expect(buildGatedCheck([publicRoad, { ...track, private: true }], [], bbox)(beyondGate)).toBe(true)
  })

  it('ignores a private driveway when a public road is within walking distance', () => {
    const driveway: RoadSegment = { coordinates: [[0.005, 0.001], [0.005, 0.003]], nodeIds: [7, 8], private: true }
    expect(buildGatedCheck([publicRoad, driveway], [], bbox)({ lat: 0.003, lng: 0.0051 })).toBe(false)
  })
})
