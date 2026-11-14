import { useMemo, type ReactNode } from "react";
import { STARRY_DEFAULTS as D, scoreStarry, type StarryPress, type StarryResponse, type StarryTrial } from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import { Stat } from "../components/ReviewFigures";
import { points, seconds } from "../lib/format";
import { Balance } from "./results";

/* Starry Night result, recomputed from the raw run. Describes this run only; never diagnoses. */

/** Every red dot back where it appeared: filled = caught (bigger = faster), dashed = missed. */
function SkyMap({ trials, responses }: { trials: StarryTrial[]; responses: StarryResponse[] }) {
  const byId = new Map(responses.map((r) => [r.trialId, r.rtMs]));
  const caught = trials.filter((t) => byId.get(t.id) != null);
  return (
    <figure className="plot sky-map">
      <svg viewBox={`0 0 ${D.width} ${D.height}`} role="img" aria-label={`${caught.length} of ${trials.length} red dots caught. Each dot drawn where it appeared.`}>
        <rect className="sky-field" x={0} y={0} width={D.width} height={D.height} rx={18} />
        <line className="sky-mid" x1={D.width / 2} x2={D.width / 2} y1={18} y2={D.height - 18} />
        {trials.map((t) => {
          const rt = byId.get(t.id);
          // Faster hits draw larger: 300 ms → 15, 1500 ms → 8.
          const r = rt == null ? 11 : Math.max(8, 15 - ((rt - 300) / 1200) * 7);
          return (
            <circle key={t.id} className={`sky-dot ${rt == null ? "missed" : "found"}`} cx={t.x} cy={t.y} r={r}>
              <title>{rt == null ? "Missed" : `Caught in ${(rt / 1000).toFixed(2)} s`}</title>
            </circle>
          );
        })}
        <text className="sky-label" x={28} y={D.height - 22}>
          Left
        </text>
        <text className="sky-label" x={D.width - 28} y={D.height - 22} textAnchor="end">
          Right
        </text>
      </svg>
      <figcaption className="plot-legend">
        <span>
          <i className="key sky-key" /> Caught (bigger = faster)
        </span>
        <span>
          <i className="key missed" /> Missed
        </span>
      </figcaption>
    </figure>
  );
}

/** Hit rate by column, far left to far right: neglect usually shows as a slope down toward the left. */
function ColumnBars({ columns }: { columns: ReturnType<typeof scoreStarry>["columns"] }) {
  const W = 480;
  const H = 150;
  const bw = W / columns.length;
  return (
    <figure className="plot column-bars">
      <svg viewBox={`0 0 ${W} ${H + 26}`} role="img" aria-label={columns.map((c) => `column ${c.col + 1}: ${c.hits} of ${c.n}`).join("; ")}>
        <line className="sky-mid" x1={W / 2} x2={W / 2} y1={0} y2={H} />
        {columns.map((c, i) => {
          const h = (c.rate ?? 0) * (H - 10);
          return (
            <g key={c.col}>
              <rect className={`col-bar ${c.col < columns.length / 2 ? "left" : "right"}`} x={i * bw + 8} y={H - h} width={bw - 16} height={Math.max(h, 1.5)} rx={4} />
              <text className="col-label" x={i * bw + bw / 2} y={H + 18} textAnchor="middle">
                {c.hits}/{c.n}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="plot-legend">
        <span>Share caught in each column, far left → far right</span>
      </figcaption>
    </figure>
  );
}

export function StarryResult({
  trials,
  responses,
  presses,
  eyebrow = "Starry Night · result",
  children,
}: {
  trials: StarryTrial[];
  responses: StarryResponse[];
  presses: StarryPress[];
  eyebrow?: string;
  children?: ReactNode;
}) {
  const s = useMemo(() => scoreStarry(trials, responses, presses), [trials, responses, presses]);
  const caught = s.left.hits + s.right.hits;
  const total = s.left.n + s.right.n;
  const gap = s.observation.value;
  return (
    <>
      <header className="page-head">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1>
            You caught {caught} of {total} red dots
          </h1>
          <p className="meta">
            {s.left.hits} of {s.left.n} on the left, {s.right.hits} of {s.right.n} on the right
            {s.falseAlarms ? ` · ${s.falseAlarms} press${s.falseAlarms === 1 ? "" : "es"} with no red dot` : ""}.
            {total <= D.demoTargets && " A short run is a taste, not a measurement."}
          </p>
        </div>
      </header>
      <section className="verdict card">
        <div className="verdict-text">
          <Eyebrow plain>Left vs right</Eyebrow>
          <h2>{Math.abs(gap) < 0.1 ? "Even on both sides" : gap < 0 ? "More red dots missed on the left" : "More red dots missed on the right"}</h2>
          <p>{s.healthyRange.text} Describes this run only; not a diagnosis.</p>
        </div>
        <Balance
          left={s.left.hits}
          right={s.right.hits}
          total={Math.max(s.left.n, s.right.n)}
          leftLabel="Left dots caught"
          rightLabel="Right dots caught"
          aria={`Left dots caught ${s.left.hits} of ${s.left.n}; right dots caught ${s.right.hits} of ${s.right.n}`}
        />
      </section>
      <section className="review-grid">
        <div className="card pad-0">
          <div className="card-head">
            <h3>Your sky</h3>
            <span className="small">Each red dot where it appeared</span>
          </div>
          <SkyMap trials={trials} responses={responses} />
        </div>
        <div className="stats">
          <Stat label="Gap, left − right" value={points(gap * 100)} sub="negative means more missed on the left" />
          <Stat label="Median reaction time" value={`${seconds(s.left.medianRtMs)} · ${seconds(s.right.medianRtMs)}`} sub="left · right, caught dots only" />
          <Stat label="Presses with no red dot" value={String(s.falseAlarms)} sub="includes presses faster than 0.15 s" />
        </div>
      </section>
      <section className="card">
        <div className="card-head">
          <h3>From far left to far right</h3>
          <span className="small">{s.rtGapMs === null ? "" : `Left ${s.rtGapMs >= 0 ? "slower" : "faster"} by ${Math.abs(Math.round(s.rtGapMs))} ms (median)`}</span>
        </div>
        <ColumnBars columns={s.columns} />
      </section>
      {children}
    </>
  );
}
