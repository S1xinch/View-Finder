import { describe, expect, it } from 'vitest'
import { describeSunset, formatClock, parseConditions, type ForecastResponse } from './conditions'

function forecast(now: string): ForecastResponse {
  const time = ['2026-10-09', '2026-10-10', '2026-10-11'].flatMap((d) =>
    Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`)
  )
  const cloud = time.map((t) => (t.startsWith('2026-10-10') ? 90 : 10))
  const low = time.map((t) => (t.startsWith('2026-10-11') ? 80 : 0))
  return {
    current: { time: now, temperature_2m: 11, cloud_cover: 9, visibility: 42380, wind_speed_10m: 7.1 },
    hourly: { time, cloud_cover: cloud, cloud_cover_low: low },
    daily: {
      time: ['2026-10-09', '2026-10-10', '2026-10-11'],
      sunrise: ['2026-10-09T06:25', '2026-10-10T06:24', '2026-10-11T06:23'],
      sunset: ['2026-10-09T19:07', '2026-10-10T19:07', '2026-10-11T19:08']
    }
  }
}

describe('parseConditions', () => {
  it("uses today's light and the cloud at each sunset hour", () => {
    const c = parseConditions(forecast('2026-10-09T15:00'))
    expect([c.sunrise, c.sunset]).toEqual(['06:25', '19:07'])
    expect(c.sunsets.map((s) => `${s.label} ${describeSunset(s)}`)).toEqual(['Tonight clear', 'Tomorrow overcast', 'Sun low cloud'])
  })

  it("moves on to tomorrow once today's sunset has passed", () => {
    const c = parseConditions(forecast('2026-10-09T21:45'))
    expect(c.sunrise).toBe('06:24')
    expect(c.sunsets[0].label).toBe('Tomorrow')
  })
})

describe('formatClock', () => {
  it('formats 24h times as 12h, with an optional shift', () => {
    expect(formatClock('19:07')).toBe('7:07 pm')
    expect(formatClock('19:07', -60)).toBe('6:07 pm')
    expect(formatClock('00:30')).toBe('12:30 am')
    expect(formatClock('00:30', -60)).toBe('11:30 pm')
  })
})
