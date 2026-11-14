/**
 * Six-bin horizontal-position bar chart (left → right). One series, so no legend; the
 * title names it. Every bar has a value label and a hover tooltip.
 */
export function BinChart({
  title,
  subtitle,
  values,
  max,
  format,
}: {
  title: string;
  subtitle?: string;
  values: ReadonlyArray<number | null>;
  max: number;
  format: (v: number) => string;
}) {
  const W = 420;
  const H = 200;
  const pad = { l: 8, r: 8, t: 22, b: 30 };
  const bw = (W - pad.l - pad.r) / values.length;
  const h = H - pad.t - pad.b;
  return (
    <figure className="card scr-chart">
      <figcaption>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${values.map((v, i) => `bin ${i + 1} ${v === null ? "no targets" : format(v)}`).join(", ")}`}>
        <line className="scr-chart-base" x1={pad.l} x2={W - pad.r} y1={pad.t + h} y2={pad.t + h} />
        <line className="scr-chart-mid" x1={W / 2} x2={W / 2} y1={pad.t - 10} y2={pad.t + h} />
        {values.map((v, i) => {
          const x = pad.l + i * bw + 3;
          const bh = v === null ? 0 : Math.max(2, (h * Math.min(v, max)) / max);
          return (
            <g key={i} className="scr-bar">
              <rect x={x} y={pad.t + h - bh} width={bw - 6} height={bh} rx={4} />
              <text x={x + (bw - 6) / 2} y={pad.t + h - bh - 6} textAnchor="middle" className="scr-bar-val">
                {v === null ? "–" : format(v)}
              </text>
              <title>{`${i < 3 ? "Left" : "Right"} bin ${i + 1}: ${v === null ? "no targets" : format(v)}`}</title>
            </g>
          );
        })}
        <text x={pad.l} y={H - 8} className="scr-chart-axis">
          Left edge
        </text>
        <text x={W - pad.r} y={H - 8} textAnchor="end" className="scr-chart-axis">
          Right edge
        </text>
      </svg>
    </figure>
  );
}
