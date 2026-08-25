/**
 * Lumen icon set — hand-drawn inline SVG, one voice.
 *
 * 24px grid, 1.8px stroke, round caps, currentColor. Icons inherit text color
 * so tinting is a CSS concern, never a prop soup.
 */

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  }
}

export function ArrowUpRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  )
}

export function ArrowDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </svg>
  )
}

export function Plus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function ShieldCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.2 5 6v5.2c0 4.4 2.9 7.6 7 9.6 4.1-2 7-5.2 7-9.6V6l-7-2.8Z" />
      <path d="m9 12.2 2.1 2.1L15.3 10" />
    </svg>
  )
}

export function Sparkle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6Z" />
      <path d="M19 15.5c.25 1.6.9 2.25 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.25 2.25-.9 2.5-2.5Z" />
    </svg>
  )
}

export function Close(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

export function ChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  )
}

export function ChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 9 7 7 7-7" />
    </svg>
  )
}

export function Copy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 14.5A2.5 2.5 0 0 1 4 12.5v-6A2.5 2.5 0 0 1 6.5 4h6A2.5 2.5 0 0 1 14.5 5" />
    </svg>
  )
}

export function Check(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

export function Share(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v12" />
      <path d="m7.5 7.5 4.5-4.5 4.5 4.5" />
      <path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12" />
    </svg>
  )
}

export function Eye(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function EyeOff(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4.5 20 19.5" />
      <path d="M9.9 6a9.5 9.5 0 0 1 2.1-.24C18 5.76 21.5 12 21.5 12a17 17 0 0 1-2.6 3.4M14.7 14.9A3 3 0 0 1 9.4 12c0-.5.1-1 .35-1.4" />
      <path d="M6.3 7.6A16.5 16.5 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.26 3.3-.68" />
    </svg>
  )
}

export function People(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8.5" r="3.3" />
      <path d="M3.5 19.5c.7-3.2 2.8-5 5.5-5s4.8 1.8 5.5 5" />
      <path d="M15.5 5.6a3.3 3.3 0 0 1 0 5.8M17.6 14.9c1.7.8 2.6 2.4 2.9 4.6" />
    </svg>
  )
}

export function Wallet(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="6" width="18" height="13" rx="3" />
      <path d="M3 10h18" opacity="0" />
      <path d="M16 12.5h2.5" />
      <path d="M7 6V5a2 2 0 0 1 2-2h9" opacity="0.6" />
    </svg>
  )
}

export function Clock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

export function Warning(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4 2.8 19.5h18.4L12 4Z" />
      <path d="M12 10v4.2" />
      <path d="M12 16.9v.1" strokeWidth={2.4} />
    </svg>
  )
}

export function Dots(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="5.5" cy="12" r="0.4" strokeWidth={2.4} />
      <circle cx="12" cy="12" r="0.4" strokeWidth={2.4} />
      <circle cx="18.5" cy="12" r="0.4" strokeWidth={2.4} />
    </svg>
  )
}

export function LinkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 6.5 12.2 4.3a4.2 4.2 0 0 1 6 5.9l-2.3 2.3" />
      <path d="m14 17.5-2.2 2.2a4.2 4.2 0 0 1-6-5.9l2.3-2.3" />
      <path d="m9.2 14.8 5.6-5.6" />
    </svg>
  )
}

export function Receipt(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3.5h12V21l-2.4-1.6L13.2 21l-2.4-1.6L8.4 21 6 19.4V3.5Z" transform="translate(0 -0.5)" />
      <path d="M9.5 8.5h5M9.5 12h5" />
    </svg>
  )
}

export function Lock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  )
}

export function Globe(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5Z" />
    </svg>
  )
}

export function ArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12h15" />
      <path d="m13 5.5 6.5 6.5-6.5 6.5" />
    </svg>
  )
}

/** The Lumen mark: a soft ring with light entering from above. */
export function LumenMark({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <circle cx="12" cy="13" r="7.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 1.8v4.4M6.2 3.9l1.9 2.7M17.8 3.9l-1.9 2.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="13" r="2.6" fill="currentColor" />
    </svg>
  )
}
