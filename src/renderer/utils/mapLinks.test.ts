import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMapsAppLinks } from './mapLinks'

const spot = { lat: -33.6284, lng: 150.3114 }

describe('buildMapsAppLinks', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('offers Apple and Google Maps driving directions everywhere', () => {
    const links = buildMapsAppLinks(spot, 'Govetts Leap')
    expect(links.map((l) => l.label)).toEqual(['Apple Maps', 'Google Maps'])
    expect(links[0].href).toBe('https://maps.apple.com/?daddr=-33.6284,150.3114&dirflg=d')
    expect(links[1].href).toBe('https://www.google.com/maps/dir/?api=1&destination=-33.6284,150.3114&travelmode=driving')
  })

  it('adds Organic Maps on phones, routing from the user when their location is known', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })
    const organic = buildMapsAppLinks(spot, 'Govetts Leap', { lat: -33.63, lng: 150.28 }).at(-1)!
    expect(organic.label).toBe('Organic Maps')
    // Organic Maps rejects route links whose params are out of this exact order.
    expect(organic.href).toBe('om://route?sll=-33.63,150.28&saddr=&dll=-33.6284,150.3114&daddr=Govetts%20Leap&type=vehicle')
    expect(organic.newTab).toBe(false)
  })

  it('opens Organic Maps on the pin when the user location is unknown', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15)', platform: 'Linux', maxTouchPoints: 5 })
    expect(buildMapsAppLinks(spot, 'Govetts Leap', null).at(-1)!.href).toBe('om://map?ll=-33.6284,150.3114&n=Govetts%20Leap')
  })
})
