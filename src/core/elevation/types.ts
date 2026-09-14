export interface LatLng {
  lat: number
  lng: number
}

export interface ElevationSample {
  lat: number
  lng: number
  elevationMeters: number | null
}

export interface PeakCandidate {
  lat: number
  lng: number
  elevationMeters: number
}
