import { useState } from "react";

export interface TrendPoint {
  id: string;
  label: string;
  value: number | null;
}

/**
 * One series of raw session points joined in date order. No smoothing, so a sparse
 * history never looks like a trajectory it doesn't have. Null values are gaps, not zeros.
 * Hover or focus a point for its exact value.
 */
export function TrendChart({
  title,
  subtitle,
  points,
  min,
  max,
  format,
  zeroLine = false,
}: {
  title: string;
  subtitle?: string;
  points: readonly TrendPoint[];
  min: number;
  max: number;
  format: (v: number) => string;
  zeroLine?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const W = 520;
  const H = 210;
  const pad = { l: 46, r: 28, t: 16, b: 30 };
  const innerW = W - pad.l - pad.r;
  const x = (i: number) => pad.l + (points.length <= 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
  const y = (v: number) => pad.t + ((max - v) * (H - pad.t - pad.b)) / (max - min || 1);

  const segments: string[] = [];
  let open = false;
  points.forEach((p, i) => {
    if (p.value === null) return void (open = false);
    segments.push(`${open ? "L" : "M"}${x(i)} ${y(p.value)}`);
    open = true;
  });
  const ticks = [max, (max + min) / 2, min];
  const hit = active !== null ? points[active] : undefined;
  const every = Math.max(1, Math.ceil(points.length / 5));
  const last = points.length - 1;

  return (
    <figure className="trend card">
      <figcaption>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}: ${points.map((p) => `${p.label} ${p.value === null ? "not available" : format(p.value)}`).join(", ")}`}
        onMouseLeave={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t} className="grid">
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {zeroLine && min < 0 && max > 0 && <line className="zero" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />}
        {hit && hit.value !== null && active !== null && (
          <line className="crosshair" x1={x(active)} x2={x(active)} y1={pad.t} y2={H - pad.b} />
        )}
        <path className="series" d={segments.join(" ")} />
        {points.map((p, i) =>
          p.value === null ? null : (
            <circle key={p.id} className={`dot ${active === i ? "on" : ""}`} cx={x(i)} cy={y(p.value)} r={active === i ? 6 : 4.5} />
          ),
        )}
        {points.map((p, i) =>
          i % every === 0 || i === last ? (
            <text key={`l-${p.id}`} className="x-label" x={x(i)} y={H - 9} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}>
              {p.label}
            </text>
          ) : null,
        )}
        {/* Hit targets wider than the marks. */}
        {points.map((p, i) => (
          <rect
            key={`h-${p.id}`}
            className="hit"
            x={x(i) - Math.max(14, innerW / Math.max(1, points.length - 1) / 2)}
            y={pad.t}
            width={Math.max(28, innerW / Math.max(1, points.length - 1))}
            height={H - pad.t - pad.b}
            tabIndex={0}
            aria-label={`${p.label}: ${p.value === null ? "not available" : format(p.value)}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          />
        ))}
        {hit && active !== null && (
          <g className="tip" transform={`translate(${Math.min(W - 150, Math.max(4, x(active) - 70))} ${pad.t - 12})`} aria-hidden>
            <rect width={140} height={36} rx={7} />
            <text x={10} y={15} className="tip-label">
              {hit.label}
            </text>
            <text x={10} y={29} className="tip-value">
              {hit.value === null ? "not available" : format(hit.value)}
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}
