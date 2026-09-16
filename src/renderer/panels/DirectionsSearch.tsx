import { useEffect, useRef, useState } from 'react'
import { useViewFinderStore } from '../state/store'
import type { PlaceResult } from '@shared/ipcContract'

const DEBOUNCE_MS = 400
const MIN_QUERY_LENGTH = 3

type SearchStatus = 'idle' | 'loading' | 'error'

// Search bar for finding arbitrary destinations (places, addresses) to get
// directions to. Unlike SearchBar.tsx which just pans the map, this creates
// a route when you pick a result.
export function DirectionsSearch(): React.JSX.Element {
  const requestRoute = useViewFinderStore((s) => s.requestRoute)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceResult[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      setStatus('idle')
      return
    }

    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current
      setStatus('loading')

      if (!window.viewFinderAPI?.searchPlaces) {
        setStatus('error')
        return
      }

      window.viewFinderAPI
        .searchPlaces(trimmed)
        .then((places) => {
          if (requestIdRef.current !== requestId) return
          setResults(places)
          setStatus('idle')
        })
        .catch((error: unknown) => {
          if (requestIdRef.current !== requestId) return
          console.error('[DirectionsSearch] searchPlaces failed', error)
          setResults([])
          setStatus('error')
        })
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const selectResult = (place: PlaceResult): void => {
    requestRoute({
      id: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      category: 'viewpoint',
      tags: {}
    })
    setQuery(place.name)
    setOpen(false)
  }

  const showDropdown = open && (results.length > 0 || (status === 'idle' && query.trim().length >= MIN_QUERY_LENGTH))

  return (
    <div className="directions-search">
      <div className="directions-search__field">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="directions-search__icon">
          <path d="M12 1C6.48 1 2 5.48 2 11c0 7 10 13 10 13s10-6 10-13c0-5.52-4.48-10-10-10m0 18s-8-5-8-7c0-4.42 3.58-8 8-8s8 3.58 8 8c0 2-8 7-8 7" fill="currentColor" />
        </svg>
        <input
          type="text"
          className="directions-search__input"
          placeholder="Address, city, or landmark…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
        />
      </div>

      {showDropdown && (
        <div className="directions-search__dropdown">
          {results.length > 0 ? (
            results.map((place) => (
              <button
                key={place.id}
                type="button"
                className="directions-search__result"
                onClick={() => selectResult(place)}
              >
                <span className="directions-search__result-name">{place.name}</span>
              </button>
            ))
          ) : status === 'loading' ? (
            <div className="directions-search__status">Searching…</div>
          ) : status === 'error' ? (
            <div className="directions-search__status">Search failed</div>
          ) : (
            <div className="directions-search__status">No results found</div>
          )}
        </div>
      )}
    </div>
  )
}
