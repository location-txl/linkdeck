import type { SVGProps } from 'react'

export type IconName =
  | 'add'
  | 'arrow-up-right'
  | 'bookmark-add'
  | 'check'
  | 'chevron-right'
  | 'close'
  | 'cloud'
  | 'deck'
  | 'download'
  | 'edit'
  | 'expand'
  | 'folder'
  | 'globe'
  | 'layers'
  | 'link'
  | 'more'
  | 'pin'
  | 'search'
  | 'settings'
  | 'trash'
  | 'upload'
  | 'warning'

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  const common = {
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

  switch (name) {
    case 'add':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'arrow-up-right':
      return (
        <svg {...common}>
          <path d="M7 17 17 7M8 7h9v9" />
        </svg>
      )
    case 'bookmark-add':
      return (
        <svg {...common}>
          <path d="M6.5 4.5A2.5 2.5 0 0 1 9 2h6a2.5 2.5 0 0 1 2.5 2.5v16l-5.5-3.4-5.5 3.4v-16Z" />
          <path d="M12 6.5v5M9.5 9h5" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common}>
          <path d="m5 12 4.2 4.2L19 6.5" />
        </svg>
      )
    case 'chevron-right':
      return (
        <svg {...common}>
          <path d="m9 5 7 7-7 7" />
        </svg>
      )
    case 'close':
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      )
    case 'cloud':
      return (
        <svg {...common}>
          <path d="M7 18.5h10a4 4 0 0 0 .7-7.94A5.5 5.5 0 0 0 7.1 9.1 4.75 4.75 0 0 0 7 18.5Z" />
          <path d="m9.5 14 1.7 1.7 3.5-3.5" />
        </svg>
      )
    case 'deck':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="12" height="14" rx="2" />
          <path d="M8 8h4M8 11h5" />
          <path d="M8 20h8a4 4 0 0 0 4-4V8" />
        </svg>
      )
    case 'download':
      return (
        <svg {...common}>
          <path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" />
          <path d="M4.5 16.5v2.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5" />
        </svg>
      )
    case 'edit':
      return (
        <svg {...common}>
          <path d="M4.5 19.5 8 18.7 18.2 8.5a2.1 2.1 0 0 0-3-3L5 15.7l-.5 3.8Z" />
          <path d="m13.8 6.8 3.4 3.4" />
        </svg>
      )
    case 'expand':
      return (
        <svg {...common}>
          <path d="M8.5 4H4v4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5" />
        </svg>
      )
    case 'folder':
      return (
        <svg {...common}>
          <path d="M3.5 6.5h6l1.8 2H20a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5v-10A2 2 0 0 1 4.5 6.5Z" />
        </svg>
      )
    case 'globe':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.8 12h16.4M12 3.5c2.1 2.3 3.2 5.1 3.2 8.5S14.1 18.2 12 20.5C9.9 18.2 8.8 15.4 8.8 12S9.9 5.8 12 3.5Z" />
        </svg>
      )
    case 'layers':
      return (
        <svg {...common}>
          <path d="m12 3 8.5 4.8L12 12.6 3.5 7.8 12 3Z" />
          <path d="m3.5 12.1 8.5 4.8 8.5-4.8M3.5 16.4l8.5 4.8 8.5-4.8" />
        </svg>
      )
    case 'link':
      return (
        <svg {...common}>
          <path d="M9.3 14.7 7.7 16.3a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0" />
          <path d="m14.7 9.3 1.6-1.6a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" />
          <path d="m8.8 15.2 6.4-6.4" />
        </svg>
      )
    case 'more':
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'pin':
      return (
        <svg {...common}>
          <path d="m8 4 8 8M14.7 4.7l4.6 4.6-3 3-.8 4.8-4.8-.8-3 3-4.6-4.6 3-3-.8-4.8 4.8.8 3-3Z" />
          <path d="m9.5 14.5-5 5" />
        </svg>
      )
    case 'search':
      return (
        <svg {...common}>
          <circle cx="10.8" cy="10.8" r="6.3" />
          <path d="m16 16 4 4" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.4 2.4-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-3.4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-2.4-2.4.1-.1A1.7 1.7 0 0 0 6 15a1.7 1.7 0 0 0-1.6-1H4.2v-3.4h.2A1.7 1.7 0 0 0 6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1L8 4.6l.1.1A1.7 1.7 0 0 0 10 5a1.7 1.7 0 0 0 1-1.6v-.2h3.4v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1h.2v3.4H21a1.7 1.7 0 0 0-1.6 1.6Z" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...common}>
          <path d="M4.5 7.5h15M9 7.5V5h6v2.5M7 7.5l.7 12h8.6l.7-12M10 11v4.8M14 11v4.8" />
        </svg>
      )
    case 'upload':
      return (
        <svg {...common}>
          <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
          <path d="M4.5 15.5V19A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-3.5" />
        </svg>
      )
    case 'warning':
      return (
        <svg {...common}>
          <path d="M10.5 4.1 2.9 17.3A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.7L13.5 4.1a1.7 1.7 0 0 0-3 0Z" />
          <path d="M12 9v4.3M12 16.7v.1" />
        </svg>
      )
    default:
      return null
  }
}
