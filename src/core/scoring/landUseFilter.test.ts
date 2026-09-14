import { describe, expect, it } from 'vitest'
import { filterExcludedLand } from './landUseFilter'
import type { Viewpoint } from '../osm/types'

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
