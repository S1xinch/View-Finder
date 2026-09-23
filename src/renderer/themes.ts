import type { ViewpointCategory } from '@shared/ipcContract'

// App chrome colours/fonts live in global.css under :root[data-theme=...];
// this file holds only what JS has to paint itself (map pins, route line).
export type ThemeName = 'apple' | 'trail' | 'night'

export const THEMES: { id: ThemeName; label: string; description: string }[] = [
  { id: 'apple', label: 'Apple', description: 'Frosted glass, follows light/dark mode' },
  { id: 'trail', label: 'Trail Guide', description: 'Topo map, park-sign colours' },
  { id: 'night', label: 'Night Summit', description: 'Dark, high-contrast for driving' }
]

export const CATEGORY_COLORS: Record<ThemeName, Record<ViewpointCategory, string>> = {
  apple: { viewpoint: '#007AFF', peak: '#C2543F', alpine_hut: '#34A853', computed_peak: '#E08A00' },
  trail: { viewpoint: '#2E4636', peak: '#9C3F28', alpine_hut: '#5B3A29', computed_peak: '#B8742A' },
  night: { viewpoint: '#5CC8FF', peak: '#FF9F5A', alpine_hut: '#7BE0A6', computed_peak: '#B9A3FF' }
}

export const ROUTE_COLORS: Record<ThemeName, { line: string; casing: string }> = {
  apple: { line: '#007AFF', casing: '#FFFFFF' },
  trail: { line: '#D98B2B', casing: '#3A2A1A' },
  night: { line: '#FFB547', casing: '#0B1018' }
}

// Only Trail and Night use web fonts (Apple uses the system font), so this
// is injected on first switch rather than loaded for every visitor.
const THEME_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@700&family=Work+Sans:wght@400;500;600&family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600&family=IBM+Plex+Mono:wght@500;600&display=swap'

export function applyThemeToDocument(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
  if (theme === 'apple' || document.getElementById('vf-theme-fonts')) return
  const link = document.createElement('link')
  link.id = 'vf-theme-fonts'
  link.rel = 'stylesheet'
  link.href = THEME_FONTS_URL
  document.head.appendChild(link)
}

const STORAGE_KEY = 'vf-theme'

export function loadTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'apple' || saved === 'trail' || saved === 'night') return saved
  } catch {
    // Storage blocked (private mode etc.) - just use the default.
  }
  return 'apple'
}

export function saveTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Not persisted this session - the choice still applies until reload.
  }
}
