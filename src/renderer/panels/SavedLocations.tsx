// Placeholder for saved locations feature (coming with Google account integration).
// Eventually, users will be able to save favorite peaks/viewpoints and quickly
// access them from the sidebar. For now, this component shows a grayed-out
// section with a "Sign in with Google" CTA.

export interface SavedLocation {
  id: string
  name: string
  lat: number
  lng: number
  savedAt: Date
}

// TODO: Add to Zustand store once accounts are integrated:
// - savedLocations: SavedLocation[]
// - currentUser: { id, email, displayName } | null
// - savePeakToLocations(viewpoint)
// - deleteSavedLocation(id)

export function SavedLocations(): React.JSX.Element {
  return (
    <div className="saved-locations">
      <div className="saved-locations__header">
        <h3 className="saved-locations__title">Saved Locations</h3>
        <span className="saved-locations__badge">Coming soon</span>
      </div>
      <div className="saved-locations__empty">
        <p className="saved-locations__text">Sign in with Google to save your favorite peaks and quickly access them.</p>
        <button type="button" className="saved-locations__signin" disabled>
          Sign in with Google
        </button>
      </div>
    </div>
  )
}
