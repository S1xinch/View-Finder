// iOS doesn't expose the display's corner radius to the web, so this maps
// the portrait screen size (in points) to the known radius - UIScreen's
// _displayCornerRadius, as catalogued by the ScreenCorners project. Only
// applied in the installed home-screen app: that's the one mode where the
// page actually reaches the physical screen corners (in a Safari tab the
// browser's toolbar sits between them).
const RADIUS_BY_SCREEN: Record<string, number> = {
  // X/XS/11 Pro are 39; 12/13 mini are 44 - same size, can't tell apart.
  '375x812': 44,
  '390x844': 47.33, // 12, 12 Pro, 13, 13 Pro, 14
  '428x926': 53.33, // 12/13 Pro Max, 14 Plus
  '393x852': 55, // 14 Pro, 15, 15 Pro, 16
  '430x932': 55, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  '402x874': 62, // 16 Pro
  '440x956': 62 // 16 Pro Max
}

// Newer Face ID iPhones not in the table yet get the most common modern value.
const FALLBACK_RADIUS = 55

export function applyDeviceCorners(): void {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (!standalone || !/iPhone/.test(navigator.userAgent)) return

  const w = Math.min(screen.width, screen.height)
  const h = Math.max(screen.width, screen.height)
  // Home-button iPhones (SE, 8 and earlier) have square screen corners.
  if (h < 812) return

  const radius =
    w === 414 && h === 896
      ? window.devicePixelRatio >= 3
        ? 39 // XS Max, 11 Pro Max
        : 41.5 // XR, 11
      : (RADIUS_BY_SCREEN[`${w}x${h}`] ?? FALLBACK_RADIUS)

  document.documentElement.classList.add('vf-device-corners')
  document.documentElement.style.setProperty('--vf-screen-radius', `${radius}px`)
}
