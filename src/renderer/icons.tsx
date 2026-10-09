// One stroke icon set (24px grid, 2px stroke, round joins) for every icon
// button in the panels, instead of text glyphs like › × → that render
// differently per font and platform.
type IconProps = { size?: number }

function Icon({ size = 18, children }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const ChevronLeftIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
)

export const ChevronRightIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
)

export const CloseIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)

// Turn-right arrow - "get directions", as in most maps apps.
export const DirectionsIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M5 19v-6a3 3 0 0 1 3-3h11M15 6l4 4-4 4" />
  </Icon>
)

export const DownloadIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
)
