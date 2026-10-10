/* Icônes SVG internes (aucun emoji) : trait fin, couleur héritée. */
import type { ReactNode } from 'react'

function base(path: ReactNode, size: number, className: string) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {path}
    </svg>
  )
}

type P = { size?: number; className?: string }

export function WarningIcon({ size = 18, className = '' }: P) {
  return base(
    <>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </>,
    size,
    className,
  )
}

export function ChatIcon({ size = 16, className = '' }: P) {
  return base(
    <>
      <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z" />
      <path d="M9 11h.01M12.5 11h.01M16 11h.01" strokeWidth="2.4" />
    </>,
    size,
    className,
  )
}

export function PhoneIcon({ size = 16, className = '' }: P) {
  return base(
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
    size,
    className,
  )
}

export function DownloadIcon({ size = 16, className = '' }: P) {
  return base(
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 21h16" />
    </>,
    size,
    className,
  )
}

export function PdfIcon({ size = 16, className = '' }: P) {
  return base(
    <>
      <path d="M6 2h8l4 4v16H6V2Z" />
      <path d="M14 2v4h4" />
      <path d="M9 13h6M9 17h6" />
    </>,
    size,
    className,
  )
}

export function TableIcon({ size = 16, className = '' }: P) {
  return base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10M15 10v10" />
    </>,
    size,
    className,
  )
}

export function CsvIcon({ size = 16, className = '' }: P) {
  return base(
    <>
      <path d="M6 2h8l4 4v16H6V2Z" />
      <path d="M14 2v4h4" />
      <path d="M9 13h.01M12 13h.01M15 13h.01M9 17h.01M12 17h.01M15 17h.01" strokeWidth="2.4" />
    </>,
    size,
    className,
  )
}

export function SearchIcon({ size = 16, className = '' }: P) {
  return base(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
    size,
    className,
  )
}

export function PencilIcon({ size = 14, className = '' }: P) {
  return base(
    <>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L8 20l-5 1 1-5L17 3Z" />
    </>,
    size,
    className,
  )
}
