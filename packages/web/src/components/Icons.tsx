import type { FC, CSSProperties } from 'react';

interface IconProps {
  className?: string;
  style?: CSSProperties;
  size?: number;
}

const svgBase = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function I({ children, size = 18, className, style }: IconProps & { children: React.ReactNode }) {
  return (
    <svg {...svgBase} width={size} height={size} className={className} style={{ flexShrink: 0, ...style }}>
      {children}
    </svg>
  );
}

export const Flash: FC<IconProps> = (p) => (
  <I {...p}><path d="M11 1L4 11h5l-1 8 7-10h-5l1-8z" /></I>
);

export const Clock: FC<IconProps> = (p) => (
  <I {...p}><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 1.5" /></I>
);

export const Anchor: FC<IconProps> = (p) => (
  <I {...p}><circle cx="10" cy="5" r="2" /><path d="M10 7v9M5.5 11.5c0 2.5 2 4.5 4.5 4.5s4.5-2 4.5-4.5M7 7H4M16 7h-3" /></I>
);

export const Folder: FC<IconProps> = (p) => (
  <I {...p}><path d="M2 5.5A1.5 1.5 0 013.5 4H7l2 2h6.5A1.5 1.5 0 0117 7.5v6a1.5 1.5 0 01-1.5 1.5h-12A1.5 1.5 0 012 13.5v-8z" /></I>
);

export const User: FC<IconProps> = (p) => (
  <I {...p}><circle cx="10" cy="6" r="3.5" /><path d="M3 18c0-3.87 3.13-7 7-7s7 3.13 7 7" /></I>
);

export const Search: FC<IconProps> = (p) => (
  <I {...p}><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4 4" /></I>
);

export const Plus: FC<IconProps> = (p) => (
  <I {...p}><path d="M10 4v12M4 10h12" /></I>
);

export const Menu: FC<IconProps> = (p) => (
  <I {...p}><path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" /></I>
);

export const Close: FC<IconProps> = (p) => (
  <I {...p}><path d="M5 5l10 10M15 5L5 15" /></I>
);

export const Key: FC<IconProps> = (p) => (
  <I {...p}><circle cx="7" cy="10" r="3" /><path d="M10 10h8M14 10v3M17 10v2" /></I>
);

export const Trash: FC<IconProps> = (p) => (
  <I {...p}><path d="M3 6h14M8 6V4a1 1 0 011-1h2a1 1 0 011 1v2M5 6v10a2 2 0 002 2h6a2 2 0 002-2V6" /></I>
);

export const Edit: FC<IconProps> = (p) => (
  <I {...p}><path d="M13.5 3.5l3 3L7 16H4v-3L13.5 3.5z" /></I>
);

export const Archive: FC<IconProps> = (p) => (
  <I {...p}><rect x="3" y="3" width="14" height="4" rx="1" /><path d="M4 7v8a2 2 0 002 2h8a2 2 0 002-2V7M10 11v4M8 13l2 2 2-2" /></I>
);

export const Tag: FC<IconProps> = (p) => (
  <I {...p}><path d="M3 10.5V4.5A1.5 1.5 0 014.5 3h6a1.5 1.5 0 011.06.44l5.5 5.5a1.5 1.5 0 010 2.12l-5.5 5.5a1.5 1.5 0 01-2.12 0l-5.5-5.5A1.5 1.5 0 013 10.5z" /><circle cx="7" cy="7" r="1" /></I>
);

export const Link: FC<IconProps> = (p) => (
  <I {...p}><path d="M8.5 11.5l3-3M11 9l1.5-1.5a2.12 2.12 0 113 3L14 12M9 11l-1.5 1.5a2.12 2.12 0 11-3-3L6 8" /></I>
);

export const Activity: FC<IconProps> = (p) => (
  <I {...p}><path d="M3 10h3l2.5-5 3 10 2.5-5h3" /></I>
);

export const Heart: FC<IconProps> = (p) => (
  <I {...p}><path d="M10 17s-7-4.35-7-8.5A3.5 3.5 0 0110 5.5 3.5 3.5 0 0117 8.5c0 4.15-7 8.5-7 8.5z" /></I>
);

export const Layers: FC<IconProps> = (p) => (
  <I {...p}><path d="M10 2L2 7l8 5 8-5-8-5z" /><path d="M2 12l8 5 8-5M2 9.5l8 5 8-5" /></I>
);

export const ChevronRight: FC<IconProps> = (p) => (
  <I {...p}><path d="M7 4l6 6-6 6" /></I>
);

export const ChevronDown: FC<IconProps> = (p) => (
  <I {...p}><path d="M4 7l6 6 6-6" /></I>
);

export const Move: FC<IconProps> = (p) => (
  <I {...p}><path d="M10 2v16M2 10h16M10 2l-3 3M10 2l3 3M10 18l-3-3M10 18l3-3M2 10l3-3M2 10l3 3M18 10l-3-3M18 10l-3 3" /></I>
);

export const Source: FC<IconProps> = (p) => (
  <I {...p}><path d="M15 3h4v4M9 11L19 3M11 5H5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-6" /></I>
);

export const Lightbulb: FC<IconProps> = (p) => (
  <I {...p}><path d="M10 2a5.5 5.5 0 00-3 10.08V14a1 1 0 001 1h4a1 1 0 001-1v-1.92A5.5 5.5 0 0010 2z" /><path d="M7.5 17h5M8 19h4" /></I>
);

export const Globe: FC<IconProps> = (p) => (
  <I {...p}><circle cx="10" cy="10" r="8" /><path d="M2 10h16M10 2c-3 3-3 13 0 16M10 2c3 3 3 13 0 16" /></I>
);

export const ArrowLeft: FC<IconProps> = (p) => (
  <I {...p}><path d="M12.5 4l-6 6 6 6" /></I>
);

export const Moon: FC<IconProps> = (p) => (
  <I {...p}><path d="M17 12.5A7.5 7.5 0 019.5 3 7.5 7.5 0 1017 12.5z" /></I>
);

export const Sun: FC<IconProps> = (p) => (
  <I {...p}>
    <circle cx="10" cy="10" r="3.5" />
    <path d="M10 1.5v2M10 16.5v2M2.5 10h2M15.5 10h2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M4.6 15.4l1.4-1.4M14 6l1.4-1.4" />
  </I>
);

export const Play: FC<IconProps> = (p) => (
  <I {...p}><path d="M5 3l12 7-12 7V3z" /></I>
);

export const Settings: FC<IconProps> = (p) => (
  <I {...p}><circle cx="10" cy="10" r="3" /><path d="M10 1v2M10 17v2M3.5 5.5l1.4 1.4M15.1 17.1l1.4 1.4M1 10h2M17 10h2M3.5 14.5l1.4-1.4M15.1 2.9l1.4-1.4" /></I>
);

export const Sparkles: FC<IconProps> = (p) => (
  <I {...p}><path d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5z" /><path d="M16 14l.8 2.2L19 17l-2.2.8L16 20l-.8-2.2L13 17l2.2-.8z" /></I>
);

export const RotateCcw: FC<IconProps> = (p) => (
  <I {...p}><path d="M3 10a7 7 0 117 7v-2" /><path d="M3 10l3-3M3 10l3 3" /></I>
);

export const Zap: FC<IconProps> = (p) => (
  <I {...p}><path d="M11 1L4 11h5l-1 8 7-10h-5l1-8z" /></I>
);

export const Brain: FC<IconProps> = (p) => (
  <I {...p}><path d="M10 3c-3.5 0-6.5 2-7 5.5-.3 2.2.7 4.3 2.5 5.5C6.5 15.5 8 17 10 17s3.5-1.5 4.5-3c1.8-1.2 2.8-3.3 2.5-5.5C16 5 13 3 10 3z" /><path d="M7 9.5c.5 0 1-.3 1.2-.8M12.8 9.5c-.3.5-.7.8-1.2.8M9.3 12.5c.4.3 1 .3 1.4 0" /></I>
);

export const Eye: FC<IconProps> = (p) => (
  <I {...p}><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" /><circle cx="10" cy="10" r="2.5" /></I>
);

export const CheckCircle: FC<IconProps> = (p) => (
  <I {...p}><circle cx="10" cy="10" r="7.5" /><path d="M6.5 10l2.5 2.5 4-4.5" /></I>
);

export const XCircle: FC<IconProps> = (p) => (
  <I {...p}><circle cx="10" cy="10" r="7.5" /><path d="M7 7l6 6M13 7L7 13" /></I>
);

export const Info: FC<IconProps> = (p) => (
  <I {...p}><circle cx="10" cy="10" r="7.5" /><path d="M10 6.5v.5M10 9.5v4" /></I>
);

export const Inbox: FC<IconProps> = (p) => (
  <I {...p}><path d="M2 8l3-5h10l3 5v6a2 2 0 01-2 2H4a2 2 0 01-2-2V8z" /><path d="M10 13v-3M6 10h8" /></I>
);

export const FileSearch: FC<IconProps> = (p) => (
  <I {...p}><path d="M11.5 1.5H5a1.5 1.5 0 00-1.5 1.5v14a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5V7.5L11.5 1.5z" /><circle cx="10" cy="12" r="2.5" /><path d="M13.5 15.5l2 2" /></I>
);

export const AlertTriangle: FC<IconProps> = (p) => (
  <I {...p}><path d="M10 3.5L1.5 17h17L10 3.5z" /><path d="M10 8v4.5M10 14.5v.5" /></I>
);

export const RefreshCw: FC<IconProps> = (p) => (
  <I {...p}><path d="M3 10a7 7 0 017-7h.5M17 10a7 7 0 01-7 7h-.5" /><path d="M14 3l3.5 3.5L14 10M6 17l-3.5-3.5L6 10" /></I>
);

export const GitMerge: FC<IconProps> = (p) => (
  <I {...p}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M6 9v6" /><circle cx="18" cy="12" r="3" /><path d="M6 6c0 3 3 3 6 3h3" /></I>
);

export const Box: FC<IconProps> = (p) => (
  <I {...p}><path d="M10 2l-7 4v8l7 4 7-4V6l-7-4z" /><path d="M10 14V6" /><path d="M3 6l7 4 7-4" /></I>
);

export const Sliders: FC<IconProps> = (p) => (
  <I {...p}><path d="M4 6h2M14 6h2M8 6h2M4 12h8M14 12h2M4 18h2M10 18h6" /><path d="M8 4v4M12 10v4M6 16v4" /></I>
);

export const Plug: FC<IconProps> = (p) => (
  <I {...p}><path d="M7 3v5M13 3v5M5 8h10v2a5 5 0 01-5 5v3M7 18h6" /></I>
);

export const Copy: FC<IconProps> = (p) => (
  <I {...p}><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M13 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2" /></I>
);

export const Terminal: FC<IconProps> = (p) => (
  <I {...p}><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M5 7l3 3-3 3M10 13h4" /></I>
);

export const Expand: FC<IconProps> = (p) => (
  <I {...p}><path d="M7 3H3v4M13 3h4v4M17 13v4h-4M7 17H3v-4" /><path d="M3 7l4-4M13 3l4 4M17 13l-4 4M7 17l-4-4" /></I>
);

export const Contract: FC<IconProps> = (p) => (
  <I {...p}><path d="M7 3v4H3M13 3v4h4M17 13h-4v4M3 13h4v4" /><path d="M7 7L3 3M13 7l4-4M13 13l4 4M7 13l-4 4" /></I>
);
