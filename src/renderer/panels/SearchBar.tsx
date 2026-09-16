import { useEffect, useRef, useState } from 'react'
import { useViewFinderStore } from '../state/store'
import type { PlaceResult } from '@shared/ipcContract'

// A real network request per keystroke would hammer Nominatim's free
// public instance well past its 1-request/second fair-use policy - this
// waits for a short pause in typing before actually searching, same
// coalescing idea as useViewpoints.ts's pan-settle debounce.
const DEBOUNCE_MS = 400
const MIN_QUERY_LENGTH = 3

type SearchStatus = 'idle' | 'loading' | 'error'

// Global place search (via Nominatim - see core/geocoding/nominatimClient.ts),
// distinct from the "Search this area" button: this jumps the map to
// wherever the user typed, rather than re-querying the current viewport.
// When a place is selected, shows "Get directions" button to route to it.
// Deliberately local component state, not the shared store - nothing else
// in the app needs to know what's mid-type in this box.
export function SearchBar(): React.JSX.Element {
  const map = useViewFinderStore((s) => s.map)
  const requestRoute = useViewFinderStore((s) => s.requestRoute)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceResult[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null)
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
          console.error('[SearchBar] searchPlaces failed', error)
          setResults([])
          setStatus('error')
        })
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const selectResult = (place: PlaceResult): void => {
    if (!map) return

    if (place.boundingBox) {
      map.fitBounds(
        [
          [place.boundingBox.west, place.boundingBox.south],
          [place.boundingBox.east, place.boundingBox.north]
        ],
        { padding: 48, duration: 800 }
      )
    } else {
      map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(map.getZoom(), 13), duration: 800 })
    }

    setQuery(place.name)
    setSelectedPlace(place)
    setOpen(false)
  }

  const getDirections = (): void => {
    if (!selectedPlace) return
    requestRoute({
      id: selectedPlace.id,
      name: selectedPlace.name,
      lat: selectedPlace.lat,
      lng: selectedPlace.lng,
      category: 'viewpoint',
      tags: {}
    })
  }

  const showDropdown = open && (results.length > 0 || (status === 'idle' && query.trim().length >= MIN_QUERY_LENGTH))

  return (
    <div className="search-bar">
      {selectedPlace && (
        <div className="search-bar__action">
          <span className="search-bar__selected">{selectedPlace.name}</span>
          <button type="button" className="search-bar__directions" onClick={getDirections} aria-label={`Get directions to ${selectedPlace.name}`}>
            →
          </button>
        </div>
      )}
      <div className="search-bar__field">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="search-bar__icon"
        >
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          className="search-bar__input"
          placeholder="Search for a place…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          // A plain blur would close the dropdown before a click on a
          // result inside it ever registers - deferring it lets that
          // click's own handler run first.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>

      {showDropdown && (
        <ul className="search-bar__results">
          {results.length === 0 && status === 'idle' && <li className="search-bar__empty">No places found</li>}
          {results.map((place) => (
            <li key={place.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => selectResult(place)}>
                {place.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
