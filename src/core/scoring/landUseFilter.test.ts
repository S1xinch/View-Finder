import { describe, expect, it } from 'vitest'
import { filterExcludedLand, filterExcludedTenure, tenureCacheKey } from './landUseFilter'
import type { Viewpoint } from '../osm/types'
import type { NswTenureClass } from '../landTenure/nswLandTenureClient'

function makeViewpoint(id: string, lat: number, lng: number): Viewpoint {
  return { id, lat, lng, category: 'viewpoint', tags: {} }
}

const farmSquare = {
  ring: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0]
  ] as [number, number][]
}

describe('filterExcludedLand', () => {
  it('returns candidates unchanged when there are no excluded areas', () => {
    const candidates = [makeViewpoint('a', 0.5, 0.5)]
    expect(filterExcludedLand(candidates, [])).toEqual(candidates)
  })

  it('drops a candidate that falls inside an excluded polygon', () => {
    const inside = makeViewpoint('a', 0.5, 0.5)
    const outside = makeViewpoint('b', 5, 5)
    const result = filterExcludedLand([inside, outside], [farmSquare])
    expect(result).toEqual([outside])
  })
})

describe('filterExcludedTenure', () => {
  it('returns candidates unchanged when no tenure data is available', () => {
    const candidates = [makeViewpoint('a', -32.25, 148.6)]
    expect(filterExcludedTenure(candidates, new Map())).toEqual(candidates)
  })

  it('drops a candidate classified as Private', () => {
    const priv = makeViewpoint('a', -32.25, 148.6)
    const open = makeViewpoint('b', -33.7, 150.3)
    const tenureByKey = new Map<string, NswTenureClass | null>([
      [tenureCacheKey(priv), 'Private'],
      [tenureCacheKey(open), 'National Park']
    ])
    expect(filterExcludedTenure([priv, open], tenureByKey)).toEqual([open])
  })

  it('drops a candidate classified as Indigenous Owned', () => {
    const indigenous = makeViewpoint('a', -32.25, 148.6)
    const tenureByKey = new Map<string, NswTenureClass | null>([[tenureCacheKey(indigenous), 'Indigenous Owned']])
    expect(filterExcludedTenure([indigenous], tenureByKey)).toEqual([])
  })

  it('keeps a Crownland-Leasehold candidate - flagged, not hard-excluded', () => {
    const leasehold = makeViewpoint('a', -32.25, 148.6)
    const tenureByKey = new Map<string, NswTenureClass | null>([[tenureCacheKey(leasehold), 'Crownland-Leasehold']])
    expect(filterExcludedTenure([leasehold], tenureByKey)).toEqual([leasehold])
  })

  it('keeps a candidate missing from the tenure map (lookup failed or never ran)', () => {
    const unknown = makeViewpoint('a', -32.25, 148.6)
    const known = makeViewpoint('b', -33.7, 150.3)
    const tenureByKey = new Map<string, NswTenureClass | null>([[tenureCacheKey(known), 'Private']])
    expect(filterExcludedTenure([unknown, known], tenureByKey)).toEqual([unknown])
  })

  it('keeps a candidate whose lookup came back null (outside NSW)', () => {
    const outsideNsw = makeViewpoint('a', -32.25, 148.6)
    const tenureByKey = new Map<string, NswTenureClass | null>([[tenureCacheKey(outsideNsw), null]])
    expect(filterExcludedTenure([outsideNsw], tenureByKey)).toEqual([outsideNsw])
  })
})
