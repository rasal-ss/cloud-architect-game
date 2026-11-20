import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const IconBack = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 3 5 8l5 5" />
  </svg>
);
export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
  </svg>
);
export const IconPause = (p: P) => (
  <svg {...base(p)}>
    <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth={2.2} />
  </svg>
);
export const IconReplay = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5v2.5h2.5" />
  </svg>
);
export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);
export const IconCross = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 5 6 6M11 5l-6 6" />
  </svg>
);
export const IconBook = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 3.5c2-.8 3.8-.8 5.5.5v9c-1.7-1.3-3.5-1.3-5.5-.5zM13.5 3.5c-2-.8-3.8-.8-5.5.5v9c1.7-1.3 3.5-1.3 5.5-.5z" />
  </svg>
);
export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.2v3.6M8 5.2v.1" />
  </svg>
);
export const IconArrow = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

/** Earned stars are filled; the rest are outlines. */
export function Stars({ count, size = 14, label = true }: { count: number; size?: number; label?: boolean }) {
  return (
    <span
      className="stars"
      role={label ? 'img' : undefined}
      aria-label={label ? `${count} of 3 stars` : undefined}
    >
      {[1, 2, 3].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 16 16"
          aria-hidden
          className={i <= count ? 'on' : ''}
        >
          <path d="M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2l-3.9 2.2.9-4.3-3.3-3 4.4-.5z" />
        </svg>
      ))}
    </span>
  );
}
