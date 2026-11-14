/**
 * NeuroVision mark redrawn as inline SVG from the team logo (outlined left
 * hemisphere, solid right hemisphere, brass orbit, four-point star) so it stays
 * crisp at any size and follows the light and dark themes.
 */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 64 48" width={(size * 64) / 48} height={size} aria-hidden>
      <path
        className="bm-solid"
        d="M32 5.5c6.2-2.6 12.6.6 14.4 6.6 5.8 1.6 8.6 8.6 5.2 13.9 1.6 5.9-3.6 11-9.4 9.9-2.2 4-6 6.2-10.2 7.1Z"
      />
      <g className="bm-lines">
        <path d="M32 5.5c-6.2-2.6-12.6.6-14.4 6.6-5.8 1.6-8.6 8.6-5.2 13.9-1.6 5.9 3.6 11 9.4 9.9 2.2 4 6 6.2 10.2 7.1" />
        <path d="M32 12c-4.600-1.800-8.800.400-10.200 4.200-3.800 1.200-5.600 5.400-3.800 9" />
        <path d="M32 19c-3-1-5.800.200-6.800 2.800-2.200 1.600-2.200 4.600-.4 6.400" />
        <path d="M32 27c-2.400.800-3.600 2.800-3 5.200" />
        <path d="M21 36c1-2.600 3.400-3.800 6-3.400" />
      </g>
      <ellipse className="bm-orbit" cx="32" cy="25" rx="30" ry="7.5" transform="rotate(-13 32 25)" />
      <path className="bm-star" d="M37 13.500q1 9.500 9.500 10.500-8.500 1-9.500 10.500-1-9.500-9.500-10.500 8.500-1 9.500-10.500Z" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-name">NeuroVision</span>
      <span className="wordmark-sub">Spatial Attention Lab</span>
    </span>
  );
}

/** Small-caps label flanked by rules, echoing the logo's tagline. */
export function Eyebrow({ children, plain = false }: { children: React.ReactNode; plain?: boolean }) {
  return <span className={`eyebrow ${plain ? "plain" : ""}`}>{children}</span>;
}
