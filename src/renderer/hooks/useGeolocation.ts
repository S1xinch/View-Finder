import { useEffect } from 'react'
import { useViewFinderStore } from '../state/store'

// Uses the standard Web Geolocation API (available in Electron's renderer
// like any Chromium context) - on a desktop machine without real GPS
// hardware this typically resolves via Wi-Fi/IP-based positioning rather
// than literal satellite GPS, so accuracy varies a lot by machine/network.
export function useGeolocation(): void {
  const tracking = useViewFinderStore((s) => s.locationTracking)
  const setLocation = useViewFinderStore((s) => s.setLocation)
  const setLocationError = useViewFinderStore((s) => s.setLocationError)

  useEffect(() => {
    if (!tracking) return

    if (!navigator.geolocation) {
      setLocationError('Location services are not available on this device')
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: position.coords.accuracy
        })
      },
      (error) => {
        console.error('[useGeolocation] error', error)
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission denied'
            : "Couldn't determine your location"
        )
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 }
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [tracking, setLocation, setLocationError])
}
