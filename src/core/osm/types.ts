export type ViewpointCategory = 'viewpoint' | 'peak' | 'alpine_hut'

export interface Viewpoint {
  id: string
  lat: number
  lng: number
  category: ViewpointCategory
  name?: string
  elevationMeters?: number
  tags: Record<string, string>
}
