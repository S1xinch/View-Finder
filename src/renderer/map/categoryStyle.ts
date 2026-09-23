import type { Viewpoint } from '@shared/ipcContract'

export const CATEGORY_LABEL: Record<Viewpoint['category'], string> = {
  viewpoint: 'Viewpoint',
  peak: 'Peak',
  alpine_hut: 'Alpine hut',
  computed_peak: 'Possible peak (estimated)'
}
