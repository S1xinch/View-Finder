import { useRef } from 'react'
import { animate } from 'motion'
import type { AnimationOptions } from 'motion'

/**
 * Hook for applying spring animations to DOM elements.
 * Reads current computed values to ensure smooth interruption.
 */
export function useSpringAnimation() {
  const elementRef = useRef<HTMLElement | null>(null)

  const animateElement = (
    target: HTMLElement,
    values: Record<string, string | number>,
    options: AnimationOptions
  ) => {
    animate(target, values, options)
  }

  return { elementRef, animateElement }
}

/**
 * Calculate velocity from gesture movement
 */
export function calculateVelocity(
  distance: number,
  timeElapsed: number,
  minThreshold: number = 10
): number {
  if (Math.abs(distance) < minThreshold) return 0
  return distance / (timeElapsed / 1000)
}
