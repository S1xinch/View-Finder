import { useEffect } from 'react'

// Keeps the screen from sleeping mid-turn-by-turn, the same reason Apple/
// Google Maps do it - Screen Wake Lock is a plain browser API (no
// dependency needed), and unsupported browsers just silently get the
// normal auto-sleep behavior back via the catch below.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return

    let lock: WakeLockSentinel | null = null
    let pending = false
    let cancelled = false

    // The browser releases the lock whenever the page is hidden (switching
    // apps, a phone call, locking the screen), so it has to be re-requested
    // each time the page becomes visible again, not just once.
    const acquire = (): void => {
      if (cancelled || pending || document.visibilityState !== 'visible') return
      if (lock && !lock.released) return
      pending = true
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (cancelled) {
            sentinel.release()
            return
          }
          lock = sentinel
        })
        .catch((error: unknown) => {
          console.error('[useWakeLock] request failed', error)
        })
        .finally(() => {
          pending = false
        })
    }

    acquire()
    document.addEventListener('visibilitychange', acquire)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      lock?.release()
    }
  }, [active])
}
