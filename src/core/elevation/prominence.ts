import type { BBox } from '../geo/types'
import type { ElevationSample, LatLng, PeakCandidate } from './types'

// 10x10 = 100 points, matching Open-Meteo's elevation API
// per-request limit (see elevationClient.ts) so a whole viewport's grid
// fits in a single request.
export const GRID_SIZE = 10

// Local maxima are only worth surfacing if they're meaningfully higher than
// most of the surrounding area, not just a hair above their immediate
// neighbors - otherwise gently undulating terrain produces a noisy
// scattering of barely-there "peaks". Keeping only the top quartile of
// sampled elevations is a coarse but effective proxy for "actually stands
// out in this view" without needing a full topographic-prominence
// calculation over a sparse point grid.
const PROMINENCE_PERCENTILE = 0.75

export function buildSampleGrid(bbox: BBox, gridSize = GRID_SIZE): LatLng[] {
  const points: LatLng[] = []
  const latStep = (bbox.north - bbox.south) / gridSize
  const lngStep = (bbox.east - bbox.west) / gridSize

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      points.push({
        lat: bbox.south + (row + 0.5) * latStep,
        lng: bbox.west + (col + 0.5) * lngStep
      })
    }
  }

  return points
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[index]
}

// samples must be in the same row-major order buildSampleGrid produced
// them in (gridSize x gridSize).
export function findLocalMaxima(samples: ElevationSample[], gridSize = GRID_SIZE): PeakCandidate[] {
  const at = (row: number, col: number): ElevationSample | undefined => samples[row * gridSize + col]

  const validElevations = samples
    .map((s) => s.elevationMeters)
    .filter((e): e is number => e !== null)
  const threshold = percentile(validElevations, PROMINENCE_PERCENTILE)

  const maxima: PeakCandidate[] = []

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const center = at(row, col)
      if (!center || center.elevationMeters === null) continue
      if (center.elevationMeters < threshold) continue

      let isMax = true
      for (let dr = -1; dr <= 1 && isMax; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const neighbor = at(row + dr, col + dc)
          if (!neighbor || neighbor.elevationMeters === null) continue
          if (neighbor.elevationMeters >= center.elevationMeters) {
            isMax = false
            break
          }
        }
      }

      if (isMax) {
        maxima.push({ lat: center.lat, lng: center.lng, elevationMeters: center.elevationMeters })
      }
    }
  }

  return maxima
}
