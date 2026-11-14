import { useMemo, useState } from "react";
import type { BisectionMetrics, GazeMetrics, SessionResult, StarMetrics } from "../../metrics/types";
import { isTracked } from "../../metrics/gaze";
import { sessionToJson } from "../../metrics/types";
import { BinChart } from "./charts";

const pct = (v: number | null | undefined, d = 0) => (v == null ? "n/a" : `${(v * 100).toFixed(d)}%`);
const signed = (v: number | null | undefined, d = 2, unit = "") => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(d)}${unit}`);
const HEAT_CELL = 40;
const DEVIATION_LABELS: Record<string, string> = {
  centerOfCancellation: "Center of Cancellation",
  hitAsymmetry: "Hit-rate asymmetry",
  gazeLeftDeficit: "Gaze left deficit",
  bisectionShift: "Bisection shift",
};

export function downloadJson(name: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

function Card({ label, value, sub, flag }: { label: string; value: string; sub?: string; flag?: boolean }) {
  return (
    <div className={`stat ${flag ? "scr-flag" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function starPoints(x: number, y: number, r: number) {
  return Array.from({ length: 10 }, (_, i) => {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}`;
  }).join(" ");
}

/** Map of the test page: found / missed / missed-but-looked-at targets, search path, optional gaze heatmap. */
function SessionMap({ session, heat, path }: { session: SessionResult; heat: boolean; path: boolean }) {
  const { layout, taps, gaze } = session;
  const { width: W, height: H } = layout.area;
  const g = session.metrics.gaze;
  const looked = new Set(g?.missedLookedAt ?? []);

  const cells = useMemo(() => {
    if (!heat) return [];
    const cols = Math.ceil(W / HEAT_CELL);
    const rows = Math.ceil(H / HEAT_CELL);
    const grid = new Array<number>(cols * rows).fill(0);
    const s = gaze.filter(isTracked);
    s.forEach((p, i) => {
      const next = s[i + 1];
      const w = next ? Math.min(120, next.t - p.t) : 0;
      const c = Math.min(cols - 1, Math.max(0, Math.floor(p.x! / HEAT_CELL)));
      const r = Math.min(rows - 1, Math.max(0, Math.floor(p.y! / HEAT_CELL)));
      grid[r * cols + c]! += w;
    });
    const peak = Math.max(1, ...grid);
    return grid.map((v, i) => ({ i, x: (i % cols) * HEAT_CELL, y: Math.floor(i / cols) * HEAT_CELL, v: v / peak, ms: v })).filter((c) => c.v > 0.02);
  }, [gaze, heat, W, H]);

  return (
    <svg className="scr-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Test page with found, missed and looked-at targets">
      <rect width={W} height={H} rx={14} className="scr-map-bg" />
      <line x1={W / 2} x2={W / 2} y1={0} y2={H} className="scr-map-mid" />
      {cells.map((c) => (
        <rect key={c.i} x={c.x} y={c.y} width={HEAT_CELL} height={HEAT_CELL} className="scr-heat" opacity={0.08 + 0.6 * c.v}>
          <title>{`${Math.round(c.ms)} ms of gaze`}</title>
        </rect>
      ))}
      {layout.kind === "star-cancellation" ? (
        <>
          {layout.items
            .filter((i) => i.kind !== "target")
            .map((i) =>
              i.kind === "letter" ? (
                <text key={i.id} x={i.x} y={i.y + i.size * 0.6} textAnchor="middle" className="scr-map-distractor" fontSize={i.size * 1.7}>
                  {i.letter}
                </text>
              ) : (
                <polygon key={i.id} points={i.kind === "big-star" ? starPoints(i.x, i.y, i.size) : `${i.x},${i.y - i.size} ${i.x + i.size},${i.y + i.size * 0.8} ${i.x - i.size},${i.y + i.size * 0.8}`} className="scr-map-distractor" />
              ),
            )}
          {path && (
            <polyline
              className="scr-map-path"
              points={taps
                .filter((t) => t.kind === "cancel")
                .map((t) => `${t.x},${t.y}`)
                .join(" ")}
            />
          )}
          {layout.items
            .filter((i) => i.kind === "target")
            .map((i) => {
              const found = taps.some((t) => t.kind === "cancel" && t.targetId === i.id);
              const cls = found ? "found" : looked.has(i.id) ? "looked" : "missed";
              return (
                <g key={i.id} className={`scr-target ${cls}`}>
                  {cls === "looked" && <circle cx={i.x} cy={i.y} r={i.size * 2.1} className="scr-looked-ring" />}
                  <polygon points={starPoints(i.x, i.y, i.size * 1.25)} />
                  <title>{found ? "Found" : cls === "looked" ? "Missed, but gaze dwelt here (approximate)" : "Missed"}</title>
                </g>
              );
            })}
          {taps
            .filter((t) => t.kind !== "cancel")
            .map((t, k) => (
              <g key={k} className={`scr-tap ${t.kind}`}>
                <circle cx={t.x} cy={t.y} r={7} />
                <title>{t.kind === "revisit" ? "Revisit (tapped an already crossed-out star)" : "Wrong tap"}</title>
              </g>
            ))}
        </>
      ) : (
        <>
          {layout.lines.map((l, k) => {
            const tap = taps.find((t) => t.kind === "cancel" && t.targetId === l.id);
            const dev = session.metrics.test.kind === "line-bisection" ? session.metrics.test.deviations[k] : null;
            const mid = (l.x1 + l.x2) / 2;
            return (
              <g key={l.id} className="scr-line">
                <line x1={l.x1} x2={l.x2} y1={l.y} y2={l.y} className={tap ? "answered" : "unanswered"} />
                <line x1={mid} x2={mid} y1={l.y - 9} y2={l.y + 9} className="scr-line-mid" />
                {tap && <line x1={tap.x} x2={tap.x} y1={l.y - 13} y2={l.y + 13} className="scr-line-tap" />}
                {dev != null && (
                  // Label beyond the line end, or before its start when the line reaches the right edge.
                  <text x={l.x2 + 90 > W ? l.x1 - 10 : l.x2 + 10} y={l.y + 5} textAnchor={l.x2 + 90 > W ? "end" : "start"} className="scr-line-dev">
                    {signed(dev, 1, "%")}
                  </text>
                )}
              </g>
            );
          })}
        </>
      )}
    </svg>
  );
}

function StarCards({ m, g }: { m: StarMetrics; g: GazeMetrics | null }) {
  return (
    <>
      <Card label="Center of Cancellation" value={signed(m.centerOfCancellation)} sub={m.cocFlag ? "Above 0.08: rightward shift (unvalidated flag)" : "Positive = shifted right"} flag={m.cocFlag} />
      <Card label="Found" value={`${m.hits} / ${m.targets}`} sub={pct(m.hitRate)} />
      <Card label="Left vs right half" value={`${pct(m.hitRateLeft)} · ${pct(m.hitRateRight)}`} sub="hit rate" />
      <Card label="First tap" value={m.firstTap ? m.firstTap.side : "n/a"} sub={m.firstTap ? `x = ${signed(m.firstTap.x)}` : undefined} />
      <Card label="Path crossings" value={String(m.pathCrossings)} sub={`${m.revisits} revisit${m.revisits === 1 ? "" : "s"} · ${m.commissions} wrong tap${m.commissions === 1 ? "" : "s"}`} />
      {g && <Card label="Missed but looked at" value={String(g.missedLookedAt.length)} sub="≥ 250 ms gaze nearby (approximate)" />}
    </>
  );
}

function BisectionCards({ m }: { m: BisectionMetrics }) {
  return (
    <>
      <Card label="Mean deviation" value={signed(m.meanDeviation, 1, "%")} sub="of line length · positive = right" flag={(m.meanDeviation ?? 0) > 8} />
      <Card label="Spread (SD)" value={m.sdDeviation == null ? "n/a" : `${m.sdDeviation.toFixed(1)}%`} />
      <Card label="Left vs right lines" value={`${signed(m.meanDeviationLeftLines, 1, "%")} · ${signed(m.meanDeviationRightLines, 1, "%")}`} sub="mean deviation" />
      <Card label="Lines answered" value={`${m.answered} / ${m.lines}`} />
    </>
  );
}

function GazeCards({ g }: { g: GazeMetrics }) {
  return (
    <>
      <Card label="Gaze on left half" value={pct(g.leftGazeFraction)} sub="of tracked gaze time" flag={g.leftGazeFraction !== null && g.leftGazeFraction < 0.35} />
      <Card label="Gaze CoC" value={signed(g.gazeCenterOfCancellation)} sub="mean gaze x vs targets" />
      <Card label="First look" value={g.firstLookDirection ?? "n/a"} sub="after leaving centre" />
      <Card label="Leftmost reach" value={signed(g.leftmostReach)} sub="5th percentile of gaze x" />
      <Card label="Head yaw vs calibration" value={g.meanHeadYawDeg == null ? "n/a" : `${signed(g.meanHeadYawDeg, 1)}°`} sub="positive = toward left" />
      <Card label="Frames tracked" value={pct(g.trackedFraction)} />
    </>
  );
}

export function ResultsView({
  session,
  onToggleRefinement,
  refinementAvailable,
  onDownloadRecording,
}: {
  session: SessionResult;
  onToggleRefinement?: (on: boolean) => void;
  refinementAvailable: { pairs: number; looRaw: number | null; looCorrected: number | null; helps: boolean } | null;
  onDownloadRecording?: () => void;
}) {
  const [heat, setHeat] = useState(true);
  const [path, setPath] = useState(true);
  const m = session.metrics;
  const t = m.test;
  const g = m.gaze;
  const gazeShare = g ? (() => {
    const total = g.gazeMsByBin.reduce((a, b) => a + b, 0);
    return g.gazeMsByBin.map((v) => (total ? v / total : null));
  })() : null;
  const v = session.quality.validation;
  const applied = session.quality.clickRefinement?.applied ?? false;

  return (
    <div className="scr-results">
      <section className="card scr-sev">
        <div>
          <span className="eyebrow plain">Deviation from the healthy range</span>
          <div className="scr-sev-score">
            <strong>{m.deviation.score.toFixed(2)}</strong>
            <span className="small">0 = within the healthy range · 1 = outside it. Not a diagnosis.</span>
          </div>
          <div className="scr-sev-track" aria-hidden>
            <i style={{ width: `${m.deviation.score * 100}%` }} />
          </div>
        </div>
        <ul className="scr-sev-parts">
          {m.deviation.components.map((c) => (
            <li key={c.name}>
              <span>{DEVIATION_LABELS[c.name] ?? c.name}</span>
              <span>
                {c.value.toFixed(2)} × {c.weight.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="scr-cards">{t.kind === "star-cancellation" ? <StarCards m={t} g={g} /> : <BisectionCards m={t} />}</section>
      {g && (
        <section className="scr-cards">
          <GazeCards g={g} />
        </section>
      )}

      <section className="card pad-0">
        <div className="card-head">
          <h3>Test page</h3>
          <div className="scr-toggles">
            {g && (
              <label className="check">
                <input type="checkbox" checked={heat} onChange={(e) => setHeat(e.target.checked)} />
                Gaze heatmap
              </label>
            )}
            {t.kind === "star-cancellation" && (
              <label className="check">
                <input type="checkbox" checked={path} onChange={(e) => setPath(e.target.checked)} />
                Search path
              </label>
            )}
          </div>
        </div>
        <div className="scr-map-wrap">
          <SessionMap session={session} heat={heat && !!g} path={path} />
        </div>
        <p className="scr-legend small">
          {t.kind === "star-cancellation" ? (
            <>
              <i className="scr-key found" /> Found <i className="scr-key missed" /> Missed <i className="scr-key looked" /> Missed but looked at (approximate) <i className="scr-key pathk" /> Search path
            </>
          ) : (
            <>
              <i className="scr-key mid" /> True midpoint <i className="scr-key tap" /> Tap, with signed deviation
            </>
          )}
          {g && (
            <>
              {" "}
              <i className="scr-key heat" /> Gaze time
            </>
          )}
        </p>
      </section>

      <section className="scr-charts">
        {t.kind === "star-cancellation" && <BinChart title="Hit rate by horizontal position" subtitle="6 equal bins, left to right" values={t.hitRateByBin} max={1} format={(x) => pct(x)} />}
        {gazeShare && <BinChart title="Gaze time by horizontal position" subtitle="share of tracked gaze time" values={gazeShare} max={Math.max(0.35, ...gazeShare.map((x) => x ?? 0))} format={(x) => pct(x)} />}
      </section>

      {(v || refinementAvailable) && (
        <section className="card scr-quality">
          <h3>Tracking quality</h3>
          {v && (
            <p className="small">
              Validation: {pct(v.leftRightAccuracy)} left/right · {pct(v.cellAccuracy)} 3×3 cell · mean error {v.meanErrorPx == null ? "n/a" : `${Math.round(v.meanErrorPx)} px`} · horizontal bias{" "}
              {v.horizontalBiasPx == null ? "n/a" : `${Math.round(v.horizontalBiasPx)} px`} · correction {v.correctionApplied ? "applied" : "not applied"}
            </p>
          )}
          {refinementAvailable && onToggleRefinement && (
            <label className={`check ${refinementAvailable.helps ? "" : "disabled"}`}>
              <input type="checkbox" disabled={!refinementAvailable.helps} checked={applied} onChange={(e) => onToggleRefinement(e.target.checked)} />
              Apply click-based refinement ({refinementAvailable.pairs} clicks · leave-one-out error {refinementAvailable.looRaw == null ? "n/a" : Math.round(refinementAvailable.looRaw)} →{" "}
              {refinementAvailable.looCorrected == null ? "n/a" : Math.round(refinementAvailable.looCorrected)} px{refinementAvailable.helps ? "" : ", no improvement"})
            </label>
          )}
        </section>
      )}

      <div className="actions">
        {onDownloadRecording && session.gaze.length > 0 && (
          <button className="ghost" onClick={onDownloadRecording}>
            Download gaze recording
          </button>
        )}
        <button onClick={() => downloadJson(`${session.id}.json`, sessionToJson(session))}>Download JSON</button>
      </div>
    </div>
  );
}
