import { useMemo, type ReactNode } from "react";
import {
  CLOCK_DEFAULTS,
  greyscalesHealthyRange,
  greyscalesNormFor,
  scoreClock,
  scoreGreyscales,
  type ClockResponse,
  type ClockTrial,
  type GreyscalesResponse,
  type GreyscalesScore,
  type GreyscalesTrial,
  type ReadingDirection,
} from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import { Stat } from "../components/ReviewFigures";
import { points, seconds } from "../lib/format";
import { ClockFace } from "./ClockTask";
import { READING_LABELS } from "./GreyscalesTask";

/* Results for the clock check and greyscales, recomputed from the raw trials. They describe one run; they never diagnose. */

export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
export const fileStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const signed = (v: number | null, digits = 2) => (v === null ? "n/a" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`);

/** Angle (degrees, SVG convention) of the numeral(s) a trial's slip touched; a swap sits between its pair. */
function slipAngle(trial: ClockTrial): number {
  const changed: number[] = [];
  for (const n of trial.correct.numerals) {
    const m = trial.faulty.numerals.find((x) => x.angleDeg === n.angleDeg);
    if (!m || m.label !== n.label || m.radius !== n.radius) changed.push(n.angleDeg);
  }
  if (!changed.length) return trial.errorSide === "left" ? 180 : 0;
  const x = changed.reduce((s, a) => s + Math.cos((a * Math.PI) / 180), 0);
  const y = changed.reduce((s, a) => s + Math.sin((a * Math.PI) / 180), 0);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Every slip placed where it sat on the clock: solid = caught, dashed = missed. Stacks outward when slips share a spot. */
function SlipMap({ trials, responses }: { trials: ClockTrial[]; responses: ClockResponse[] }) {
  // Slips cluster at 8–10 and 2–4 o'clock, so marks stack outward sideways; the canvas is wide for that.
  const R = 100;
  const CX = 250;
  const CY = R + 30;
  const VW = CX * 2;
  const VH = CY * 2 + 34;
  const byId = new Map(responses.map((r) => [r.trialId, r]));
  const stacks = new Map<number, number>();
  // Caught slips sit nearest the face and missed ones further out, so each cluster reads as a small bar.
  const isCaught = (t: ClockTrial) => byId.get(t.id)?.choice === t.correctPosition;
  const ordered = [...trials].sort((a, b) => Number(isCaught(b)) - Number(isCaught(a)));
  const dots = ordered.map((t) => {
    const angle = Math.round(slipAngle(t));
    const k = stacks.get(angle) ?? 0;
    stacks.set(angle, k + 1);
    const rr = Math.min(R + 24 + k * 17, CX - 10);
    const a = (angle * Math.PI) / 180;
    const caught = isCaught(t);
    return { id: t.id, x: CX + Math.cos(a) * rr, y: CY + Math.sin(a) * rr, caught, detail: t.errorDetail };
  });
  const left = trials.filter((t) => t.errorSide === "left");
  const right = trials.filter((t) => t.errorSide === "right");
  const caught = (ts: ClockTrial[]) => ts.filter((t) => byId.get(t.id)?.choice === t.correctPosition).length;
  const base = trials[0]?.correct ?? null;

  return (
    <figure className="plot slip-map">
      <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={`Left-half slips caught ${caught(left)} of ${left.length}; right-half slips caught ${caught(right)} of ${right.length}`}>
        <rect className="board-surface" x={0} y={0} width={VW} height={VH} rx={16} />
        <path className="slip-half" d={`M${CX} ${CY - R} A${R} ${R} 0 0 0 ${CX} ${CY + R}Z`} style={{ ["--caught" as string]: String(left.length ? caught(left) / left.length : 0) }} />
        <path className="slip-half" d={`M${CX} ${CY - R} A${R} ${R} 0 0 1 ${CX} ${CY + R}Z`} style={{ ["--caught" as string]: String(right.length ? caught(right) / right.length : 0) }} />
        {base && (
          <g className="muted-face">
            <ClockFace cx={CX} cy={CY} face={base} r={R} hands={false} />
          </g>
        )}
        <line className="midline" x1={CX} x2={CX} y1={CY - R - 18} y2={CY + R + 18} />
        {dots.map((d) => (
          <circle key={d.id} className={`ring ${d.caught ? "found" : "missed"}`} cx={d.x} cy={d.y} r={6}>
            <title>{`${d.detail}: ${d.caught ? "caught" : "missed"}`}</title>
          </circle>
        ))}
        <text className="slip-label" x={24} y={VH - 16} textAnchor="start">
          Left half {caught(left)}/{left.length}
        </text>
        <text className="slip-label" x={VW - 24} y={VH - 16} textAnchor="end">
          Right half {caught(right)}/{right.length}
        </text>
      </svg>
      <figcaption className="plot-legend">
        <span>
          <i className="key" /> Slip caught
        </span>
        <span>
          <i className="key missed" /> Slip missed
        </span>
        <span>Shaded halves: share caught</span>
      </figcaption>
    </figure>
  );
}

/** Left and right counts growing out from the midline, in the same balance bar as the session review. */
export function Balance({ left, right, leftLabel, rightLabel, total, aria }: { left: number; right: number; leftLabel: string; rightLabel: string; total: number; aria: string }) {
  const side = (label: string, n: number, cls: string) => (
    <div className={`balance-side ${cls}`}>
      <div className="balance-track">
        <div className="balance-fill" style={{ width: `${total ? (100 * n) / total : 0}%` }} />
      </div>
      <div className="balance-label">
        <span>{label}</span>
        <strong>
          {n}
          <small> / {total}</small>
        </strong>
      </div>
    </div>
  );
  return (
    <div className="balance" role="img" aria-label={aria}>
      {side(leftLabel, left, "left")}
      <span className="balance-mid" aria-hidden />
      {side(rightLabel, right, "right")}
    </div>
  );
}

function greyscalesSentence(g: GreyscalesScore, reading: ReadingDirection) {
  const answered = g.darkerLeftChoices + g.darkerRightChoices;
  if (!answered) return "No pairs were answered.";
  const lean = g.bias > 0.1 ? "a leftward lean" : g.bias < -0.1 ? "a rightward lean" : "almost no lean either way";
  const range = greyscalesHealthyRange(g.bias, reading);
  const norm = greyscalesNormFor(reading);
  if (!range.calibrated) {
    return `You picked the bar that’s darker on the left ${g.darkerLeftChoices} of ${answered} times: ${lean}. Uncalibrated — no published healthy range for this reading direction.`;
  }
  return `You picked the bar that’s darker on the left ${g.darkerLeftChoices} of ${answered} times: ${lean}. Healthy-range mean for this reading direction is ${signed(norm.mean)}. ${range.text}`;
}

export function ClockResult({ trials, responses, eyebrow = "Clock check · result", children }: { trials: ClockTrial[]; responses: ClockResponse[]; eyebrow?: string; children?: ReactNode }) {
  const clock = useMemo(() => scoreClock(trials, responses), [trials, responses]);
  const caught = clock.left.correct + clock.right.correct;
  const total = clock.left.n + clock.right.n;
  return (
    <>
      <header className="page-head">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1>
            You caught {caught} of {total} slips
          </h1>
          <p className="meta">
            {clock.left.correct} of {clock.left.n} in the left half of the clock, {clock.right.correct} of {clock.right.n} in the
            right half.{total <= CLOCK_DEFAULTS.demoTrials && " Ten pairs is a taste, not a measurement; thirty is better."}
          </p>
        </div>
      </header>
      <section className="verdict card">
        <div className="verdict-text">
          <Eyebrow plain>Left half vs right half</Eyebrow>
          <h2>{clock.observation.value === 0 ? "Even on both sides" : clock.observation.value < 0 ? "More slips missed on the left" : "More slips missed on the right"}</h2>
          <p>{clock.healthyRange.text} Describes this run only; not a diagnosis.</p>
        </div>
        <Balance
          left={clock.left.correct}
          right={clock.right.correct}
          total={Math.max(clock.left.n, clock.right.n)}
          leftLabel="Left-half slips"
          rightLabel="Right-half slips"
          aria={`Left-half slips caught ${clock.left.correct} of ${clock.left.n}; right-half slips caught ${clock.right.correct} of ${clock.right.n}`}
        />
      </section>
      <section className="review-grid">
        <div className="card pad-0">
          <div className="card-head">
            <h3>Where the slips were</h3>
            <span className="small">Each mark sits by the number that was wrong</span>
          </div>
          <SlipMap trials={trials} responses={responses} />
        </div>
        <div className="stats">
          <Stat label="Gap, left − right" value={points(clock.observation.value * 100)} sub="negative means more left-half slips missed" />
          <Stat
            label="Median answer time, caught slips"
            value={`${seconds(clock.left.medianCorrectRtMs)} · ${seconds(clock.right.medianCorrectRtMs)}`}
            sub="left half · right half"
          />
          <Stat label="No answer in time" value={String(clock.timeouts)} sub={`of ${total} pairs, counted as missed`} />
        </div>
      </section>
      {children}
    </>
  );
}

export function GreyResult({ trials, responses, reading, eyebrow = "Greyscales · result", children }: { trials: GreyscalesTrial[]; responses: GreyscalesResponse[]; reading: ReadingDirection; eyebrow?: string; children?: ReactNode }) {
  const grey = useMemo(() => scoreGreyscales(trials, responses), [trials, responses]);
  const norm = greyscalesNormFor(reading);
  const answered = grey.darkerLeftChoices + grey.darkerRightChoices;
  return (
    <>
      <header className="page-head">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1>{grey.bias > 0.1 ? "You lean a little left" : grey.bias < -0.1 ? "You lean a little right" : "You barely lean either way"}</h1>
          <p className="meta">
            {trials.length} pairs · reads {READING_LABELS[reading].label.toLowerCase()}
            {grey.skipped ? ` · ${grey.skipped} left unanswered` : ""}
          </p>
        </div>
      </header>
      <section className="card">
        <div className="grey-summary">
          <div>
            <p className="suggestion-text">{greyscalesSentence(grey, reading)}</p>
            <Balance
              left={grey.darkerLeftChoices}
              right={grey.darkerRightChoices}
              total={answered}
              leftLabel="Chose darker-left"
              rightLabel="Chose darker-right"
              aria={`Chose the darker-left bar ${grey.darkerLeftChoices} times and the darker-right bar ${grey.darkerRightChoices} times`}
            />
          </div>
          <div className="stats">
            <Stat label="Lean" value={signed(grey.bias)} sub="+1 always darker-left, −1 always darker-right" />
            <Stat label="First half · second half" value={`${signed(grey.firstHalfBias)} · ${signed(grey.secondHalfBias)}`} sub="a lean often fades over a run" />
          </div>
        </div>
      </section>
      <p className={norm.calibrated === false ? "notice warn" : "notice"}>
        {norm.calibrated === false
          ? "Uncalibrated — no published healthy range for this reading direction. Research tool, not a diagnosis."
          : "Most people have a slight natural lean, and this test can see yours. Research tool, not a diagnosis."}
      </p>
      {children}
    </>
  );
}

