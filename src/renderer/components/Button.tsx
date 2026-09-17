import { useRef } from 'react'
import { animate } from 'motion'
import { springs } from '../springs'
import type { ReactNode } from 'react'

interface ButtonProps {
  onClick?: () => void
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'icon'
  disabled?: boolean
  className?: string
  title?: string
  'aria-label'?: string
}

export function Button({
  onClick,
  children,
  variant = 'primary',
  disabled = false,
  className = '',
  title,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)

  const handlePointerDown = () => {
    if (!ref.current || disabled) return
    animate(ref.current, { scale: 0.95 }, springs.snappy)
  }

  const handlePointerUp = () => {
    if (!ref.current) return
    animate(ref.current, { scale: 1 }, springs.snappy)
  }

  const handlePointerLeave = () => {
    if (!ref.current || disabled) return
    animate(ref.current, { scale: 1 }, springs.snappy)
  }

  return (
    <button
      ref={ref}
      className={`vf-button vf-button--${variant} ${className}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  )
}
