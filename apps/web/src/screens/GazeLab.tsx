import { useEffect, useMemo, useRef, useState } from "react";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  EXAMPLE_CALIBRATION_REPORT,
  GAZE_LAB_CLICK_SEQUENCE,
  GAZE_LAB_STREAMS,
  createTargetSelectionLayout,
  type GazeStream,
} from "@neurovision/domain";
import { GAZE_ANALYSIS_VERSION, SIMULATED_LAB_PROVENANCE, gazeSummary } from "@neurovision/gaze";
import { Board } from "../components/Board";
import { Eyebrow } from "../components/Brand";

const DURATION = 22_000;
const SAMPLE_MS = 100;
const CELL = 60;
const COLS = BOARD_WIDTH / CELL;
const ROWS = BOARD_HEIGHT / CELL;
const TRAIL = 14;

function dwellGrid(stream: GazeStream, until: number): number[] {
  const cells = Array<number>(COLS * ROWS).fill(0);
  for (const s of stream.samples) {
    if (s.elapsed >= until) break;
    const c = Math.min(COLS - 1, Math.max(0, Math.floor(s.x / CELL)));
    const r = Math.min(ROWS - 1, Math.max(0, Math.floor(s.y / CELL)));
    cells[r * COLS + c]! += SAMPLE_MS;
  }
  return cells;
}

function GazePanel({ stream, t, layers }: { stream: GazeStream; t: number; layers: { heat: boolean; trail: boolean; clicks: boolean } }) {
  const layout = useMemo(() => createTargetSelectionLayout("fixed-a"), []);
  const peak = useMemo(() => Math.max(1, ...dwellGrid(stream, DURATION)), [stream]);
  const cells = useMemo(() => dwellGrid(stream, t), [stream, t]);
  const summary = gazeSummary(stream, t);
  const inGap = stream.gaps.some((g) => t >= g.start && t < g.end);
  const seen = stream.samples.filter((s) => s.elapsed <= t);
  const trail = inGap ? [] : seen.slice(-TRAIL);
  const head = trail[trail.length - 1];
  const clicks = GAZE_LAB_CLICK_SEQUENCE.filter((e) => e.elapsed <= t);
  const leftShare = summary.tracked ? summary.left / summary.tracked : 0;
  const bandMax = Math.max(1, ...summary.bins);

  return (
    <article className="card gaze-panel pad-0">
      <div className="card-head">
        <h3>{stream.label}</h3>
        <span className={`badge ${inGap ? "incomplete" : "demonstration"}`}>{inGap ? "Tracking lost" : "Simulated"}</span>
      </div>
      <Board label={`${stream.label}: gaze replay at ${(t / 1000).toFixed(1)} seconds`} role="img" stimuli={layout.stimuli} stimulusClass="faint" showMidline>
        {layers.heat &&
          cells.map((ms, i) =>
            ms === 0 ? null : (
              <rect key={i} className="heat" x={(i % COLS) * CELL + 2} y={Math.floor(i / COLS) * CELL + 2} width={CELL - 4} height={CELL - 4} rx={8} opacity={0.12 + 0.68 * (ms / peak)}>
                <title>{`${(ms / 1000).toFixed(1)} s of tracked gaze`}</title>
              </rect>
            ),
          )}
        {layers.clicks &&
          clicks.map((e) => (
            <g key={e.seq} className="gaze-click">
              <circle cx={e.x} cy={e.y} r={15} />
              <title>{`Click ${e.seq} at ${(e.elapsed / 1000).toFixed(1)} s`}</title>
            </g>
          ))}
        {layers.trail && trail.length > 1 && <polyline className="gaze-trail" points={trail.map((s) => `${s.x},${s.y}`).join(" ")} />}
        {head && (
          <g className="gaze-head">
            <circle cx={head.x} cy={head.y} r={20} className="halo" />
            <circle cx={head.x} cy={head.y} r={7} />
          </g>
        )}
        {inGap && (
          <text className="gap-text" x={BOARD_WIDTH / 2} y={BOARD_HEIGHT / 2} textAnchor="middle">
            Tracking lost. No gaze is assumed.
          </text>
        )}
      </Board>
      <div className="gaze-stats">
        <div>
          <span className="stat-label">Tracked</span>
          <strong>{(summary.tracked / 1000).toFixed(1)} s</strong>
        </div>
        <div>
          <span className="stat-label">On left half</span>
          <strong>{summary.tracked ? `${Math.round(leftShare * 100)}%` : "n/a"}</strong>
        </div>
        <div className="bands" role="img" aria-label={`Gaze time across six vertical bands, left to right: ${summary.bins.map((b) => `${(b / 1000).toFixed(1)} s`).join(", ")}`}>
          {summary.bins.map((b, i) => (
            <span key={i} className={i === 2 ? "band split" : "band"} title={`Band ${i + 1}: ${(b / 1000).toFixed(1)} s`}>
              <i style={{ height: `${(100 * b) / bandMax}%` }} />
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

function CalibrationPreview() {
  const c = EXAMPLE_CALIBRATION_REPORT;
  const pts = [0, 1, 2].flatMap((r) => [0, 1, 2].map((col) => ({ x: 40 + col * 100, y: 30 + r * 55 })));
  const offsets = [
    [5, -3], [-4, 4], [6, 5], [-3, -5], [2, 2], [-6, 3], [4, -6], [-5, -2], [3, 6],
  ] as const;
  return (
    <section className="card calibration">
      <div>
        <Eyebrow plain>Calibration preview · example values</Eyebrow>
        <h3>How well would gaze land where it should?</h3>
        <p className="small">
          Nine validation points. Each ring is a target; the dot is where the estimate landed. Example figures only, no
          camera is used here.
        </p>
        <dl className="cal-stats">
          <div>
            <dt>Points</dt>
            <dd>{c.pointCount}</dd>
          </div>
          <div>
            <dt>Left / right agreement</dt>
            <dd>{Math.round(c.leftRightAgreement * 100)}%</dd>
          </div>
          <div>
            <dt>Grid agreement</dt>
            <dd>{Math.round(c.gridAgreement * 100)}%</dd>
          </div>
          <div>
            <dt>Average error</dt>
            <dd>{c.averageErrorPx} px</dd>
          </div>
        </dl>
      </div>
      <svg className="cal-grid" viewBox="0 0 280 170" role="img" aria-label="Nine-point calibration grid with example estimates">
        <rect className="board-surface" width={280} height={170} rx={10} />
        {pts.map((p, i) => (
          <g key={i}>
            <circle className="cal-target" cx={p.x} cy={p.y} r={11} />
            <line className="cal-err" x1={p.x} y1={p.y} x2={p.x + offsets[i]![0]} y2={p.y + offsets[i]![1]} />
            <circle className="cal-est" cx={p.x + offsets[i]![0]} cy={p.y + offsets[i]![1]} r={3.5} />
          </g>
        ))}
      </svg>
    </section>
  );
}

export function GazeLab({ onHome }: { onHome: () => void }) {
  const [t, setT] = useState(9_400);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [layers, setLayers] = useState({ heat: true, trail: true, clicks: true });
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return void (last.current = null);
    let frame = requestAnimationFrame(function step(now) {
      const dt = last.current === null ? 0 : now - last.current;
      last.current = now;
      setT((prev) => {
        const next = prev + dt * speed;
        if (next >= DURATION) {
          setPlaying(false);
          return DURATION;
        }
        return next;
      });
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  const toggle = (k: keyof typeof layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const gaps = GAZE_LAB_STREAMS[0].gaps;
  const px = (ms: number) => (1000 * ms) / DURATION;

  return (
    <div className="gaze-lab">
      <header className="page-head">
        <div>
          <Eyebrow>Gaze lab</Eyebrow>
          <h1>Same clicks, different looking</h1>
          <p className="meta">
            One click sequence, replayed against two gaze streams. A click total can hide where the eyes actually went.
          </p>
        </div>
        <div className="badges">
          <span className="badge demonstration">{SIMULATED_LAB_PROVENANCE.badge}</span>
        </div>
      </header>

      <section className="card transport">
        <button className="primary play" onClick={() => (t >= DURATION ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))} aria-label={playing ? "Pause replay" : "Play replay"}>
          {playing ? "Pause" : t >= DURATION ? "Replay" : "Play"}
        </button>
        <div className="timeline">
          <svg viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden>
            <defs>
              <pattern id="gap-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line className="hatch" x1="0" y1="0" x2="0" y2="7" />
              </pattern>
            </defs>
            <rect className="tl-track" x={0} y={15} width={1000} height={10} rx={5} />
            <rect className="tl-done" x={0} y={15} width={px(t)} height={10} rx={5} />
            {gaps.map((g) => (
              <rect key={g.start} className="tl-gap" x={px(g.start)} y={9} width={px(g.end - g.start)} height={22} fill="url(#gap-hatch)" />
            ))}
            {GAZE_LAB_CLICK_SEQUENCE.map((e) => (
              <line key={e.seq} className={`tl-click ${e.elapsed <= t ? "past" : ""}`} x1={px(e.elapsed)} x2={px(e.elapsed)} y1={3} y2={12} />
            ))}
            <line className="tl-head" x1={px(t)} x2={px(t)} y1={2} y2={38} />
          </svg>
          <input
            type="range"
            min={0}
            max={DURATION}
            step={100}
            value={Math.round(t)}
            onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))}
            aria-label="Replay position"
            aria-valuetext={`${(t / 1000).toFixed(1)} of ${DURATION / 1000} seconds`}
          />
        </div>
        <span className="clock">
          {(t / 1000).toFixed(1)}
          <small> / {DURATION / 1000} s</small>
        </span>
        <div className="segmented tight" role="group" aria-label="Replay speed">
          {[1, 2, 4].map((s) => (
            <label key={s} className={speed === s ? "on" : ""}>
              <input type="radio" name="speed" checked={speed === s} onChange={() => setSpeed(s)} />
              {s}×
            </label>
          ))}
        </div>
        <div className="tl-legend">
          <span>
            <i className="key tl-k-click" /> Click
          </span>
          <span>
            <i className="key tl-k-gap" /> Tracking gap
          </span>
          {(["heat", "trail", "clicks"] as const).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} />
              {k === "heat" ? "Heatmap" : k === "trail" ? "Gaze trail" : "Clicks"}
            </label>
          ))}
        </div>
      </section>

      <section className="gaze-grid">
        {GAZE_LAB_STREAMS.map((stream) => (
          <GazePanel key={stream.id} stream={stream} t={t} layers={layers} />
        ))}
      </section>

      <CalibrationPreview />

      <p className="small">
        {SIMULATED_LAB_PROVENANCE.disclaimer} Tracking gaps contribute no gaze time. Analysis {GAZE_ANALYSIS_VERSION}.
      </p>
      <div className="actions">
        <button onClick={onHome}>Home</button>
      </div>
    </div>
  );
}
