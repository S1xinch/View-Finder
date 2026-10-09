import { useState } from 'react'
import { DownloadIcon } from '../icons'
import { clearSavedAreas, hasSavedAreas, offlineSupport } from '../utils/offlineArea'

type SaveState = { kind: 'idle' } | { kind: 'saving'; progress: number } | { kind: 'done' | 'error'; text: string }

// A "save for offline" button with progress, result, and a way to clear
// everything saved. `save` does the work: an area (Sidebar) or a drive
// (DirectionsView). Website only - see offlineSupport.
export function OfflineSave({
  label,
  save
}: {
  label: string
  save: (onProgress: (fraction: number) => void) => Promise<{ bytes: number }>
}): React.JSX.Element | null {
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  const [saved, setSaved] = useState(hasSavedAreas)
  if (!offlineSupport.enabled) return null

  const run = async (): Promise<void> => {
    setState({ kind: 'saving', progress: 0 })
    try {
      const { bytes } = await save((progress) => setState({ kind: 'saving', progress }))
      setState({ kind: 'done', text: `Saved for offline · ${(bytes / 1e6).toFixed(1)} MB` })
      setSaved(true)
    } catch (error) {
      setState({ kind: 'error', text: error instanceof Error ? error.message : "Couldn't save for offline" })
    }
  }
  const clear = async (): Promise<void> => {
    await clearSavedAreas()
    setSaved(false)
    setState({ kind: 'idle' })
  }

  return (
    <div className="offline-save">
      <button type="button" className="sidebar__search-button" onClick={run} disabled={state.kind === 'saving'}>
        <DownloadIcon size={14} />
        {state.kind === 'saving' ? `Saving map… ${Math.round(state.progress * 100)}%` : label}
      </button>
      {(state.kind === 'done' || state.kind === 'error' || saved) && (
        <div className="offline-save__status" role="status">
          {(state.kind === 'done' || state.kind === 'error') && <span>{state.text}</span>}
          {saved && (
            <button type="button" className="offline-save__clear" onClick={clear}>
              Clear offline maps
            </button>
          )}
        </div>
      )}
    </div>
  )
}
