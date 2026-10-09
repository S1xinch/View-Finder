// Weather and light at a spot, from Open-Meteo (free, no key, CORS-enabled -
// the same provider as elevation). Loaded only when a spot card opens.

export interface SunsetOutlook {
  label: string
  // Overall cloud at the sunset hour, and low cloud (the kind that sits on
  // the ridges and hides the view rather than lighting up the sky).
  cloudPct: number
  lowCloudPct: number
}

export interface Conditions {
  tempC: number
  cloudPct: number
  visibilityM: number
  windKmh: number
  // Location-local "HH:MM" for the next sunrise/sunset still to come.
  sunrise: string
  sunset: string
  sunsets: SunsetOutlook[]
}

export interface ForecastResponse {
  current: { time: string; temperature_2m: number; cloud_cover: number; visibility: number; wind_speed_10m: number }
  hourly: { time: string[]; cloud_cover: number[]; cloud_cover_low: number[] }
  daily: { time: string[]; sunrise: string[]; sunset: string[] }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function parseConditions(r: ForecastResponse): Conditions {
  const now = r.current.time
  // Past today's sunset, the next light worth planning for is tomorrow's.
  const day = r.daily.sunset[0] < now && r.daily.sunset.length > 1 ? 1 : 0
  const sunsets = r.daily.time.map((date, i) => {
    const hour = r.daily.sunset[i].slice(0, 13) + ':00'
    const h = Math.max(0, r.hourly.time.indexOf(hour))
    const [y, m, d] = date.split('-').map(Number)
    const label = i === 0 ? 'Tonight' : i === 1 ? 'Tomorrow' : WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    return { label, cloudPct: r.hourly.cloud_cover[h], lowCloudPct: r.hourly.cloud_cover_low[h] }
  })

  return {
    tempC: r.current.temperature_2m,
    cloudPct: r.current.cloud_cover,
    visibilityM: r.current.visibility,
    windKmh: r.current.wind_speed_10m,
    sunrise: r.daily.sunrise[day].slice(11),
    sunset: r.daily.sunset[day].slice(11),
    sunsets: sunsets.slice(day, day + 3)
  }
}

export function describeSunset(s: SunsetOutlook): string {
  if (s.lowCloudPct >= 60) return 'low cloud'
  if (s.cloudPct < 25) return 'clear'
  // Some mid/high cloud is what makes a sunset colourful.
  if (s.cloudPct < 70) return 'some cloud'
  return 'overcast'
}

// "19:07" -> "7:07 pm", optionally shifted by minutes.
// ponytail: golden hour is taken as the hour after sunrise / before sunset;
// a solar-altitude calculation would be exact if that ever matters.
export function formatClock(hhmm: string, shiftMinutes = 0): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = (((h * 60 + m + shiftMinutes) % 1440) + 1440) % 1440
  const hour = Math.floor(total / 60)
  return `${hour % 12 || 12}:${String(total % 60).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`
}

const CACHE_TTL_MS = 15 * 60 * 1000
const cache = new Map<string, { at: number; result: Promise<Conditions> }>()

export function fetchConditions(lat: number, lng: number): Promise<Conditions> {
  // ~1km grid - the forecast model is coarser than that anyway.
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    '&current=temperature_2m,cloud_cover,visibility,wind_speed_10m' +
    '&hourly=cloud_cover,cloud_cover_low&daily=sunrise,sunset&timezone=auto&forecast_days=4'
  const result = fetch(url, { signal: AbortSignal.timeout(8000) })
    .then((res) => {
      if (!res.ok) throw new Error(`Open-Meteo forecast ${res.status}`)
      return res.json() as Promise<ForecastResponse>
    })
    .then(parseConditions)
  result.catch(() => cache.delete(key))
  cache.set(key, { at: Date.now(), result })
  return result
}
