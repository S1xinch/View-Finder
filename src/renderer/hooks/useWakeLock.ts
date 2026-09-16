import { useEffect } from 'react'

// Keeps the screen from sleeping mid-turn-by-turn, the same reason Apple/
// Google Maps do it - Screen Wake Lock is a plain browser API (no
// dependency needed), and unsupported browsers just silently get the
// normal auto-sleep behavior back via the try/catch below.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return

    let lock: WakeLockSentinel | null = null
    let cancelled = false

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

    return () => {
      cancelled = true
      lock?.release()
    }
  }, [active])
}
