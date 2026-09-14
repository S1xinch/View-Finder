// Same artwork as build/icon-source.svg (the source for the actual .exe/
// .dmg icon) at UI scale, so the in-app mark and the installed app's icon
// are the same logo rather than two different things.
export function Logo(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="vf-logo-bg" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4a86ff" />
          <stop offset="1" stopColor="#2657c9" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" rx="22" fill="url(#vf-logo-bg)" />
      <g fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20,34 L20,20 L34,20" />
        <path d="M66,20 L80,20 L80,34" />
        <path d="M20,66 L20,80 L34,80" />
        <path d="M80,66 L80,80 L66,80" />
      </g>
      <circle cx="68" cy="34" r="6" fill="#ffffff" opacity="0.92" />
      <path d="M24,68 L41,41 L49,51 L59,35 L76,68 Z" fill="#ffffff" />
    </svg>
  )
}
