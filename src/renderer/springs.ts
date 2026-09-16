import type { AnimationOptions } from 'motion'

export const springs = {
  // UI elements: buttons, toggles, instant feedback
  snappy: { type: 'spring', bounce: 0, duration: 0.3 } as const satisfies AnimationOptions,

  // Standard motion: panels, modals, smooth transitions
  smooth: { type: 'spring', bounce: 0, duration: 0.4 } as const satisfies AnimationOptions,

  // Gesture release: carry velocity from drag
  momentum: { type: 'spring', bounce: 0.15, duration: 0.4 } as const satisfies AnimationOptions,

  // Arrival: celebration, emphasis
  elastic: { type: 'spring', bounce: 0.25, duration: 0.5 } as const satisfies AnimationOptions,
} as const

export function calculateGestureVelocity(distance: number, timeElapsed: number): number {
  return distance / (timeElapsed / 1000)
}

export function projectMomentum(velocity: number, decelerationRate: number = 0.998): number {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate)
}
