import { useMemo, useRef, useState, type PointerEvent } from "react";
import {
  CLOCK_DEFAULTS,
  generateClockTrials,
  type ClockFace as Face,
  type ClockResponse,
  type ClockTrial,
  type StackPosition,
} from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import { KeyHints, StartOverlay, TrialDial } from "./StackedTask";
import { pointerToChoice, useStackedTrials } from "./stackedTrials";

/* Geometry from the clock spec: 400 × 640 viewBox, faces of radius 130 centred at y = 160 and y = 480. */
const W = 400;
const H = 640;
const R = 130;
const CX = W / 2;
const CY: Record<StackPosition, number> = { top: 160, bottom: 480 };
const SPLIT_Y = H / 2;
const FIXATION_MS = 500;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** One clock face. Drawn in currentColor, so it follows the theme through `.clock-face { color: var(--stim) }`. */
export function ClockFace({ cx, cy, face, r = R, hands = true }: { cx: number; cy: number; face: Face | null; r?: number; hands?: boolean }) {
  const hand = (deg: number, len: number, cls: string) => (
    <line className={cls} x1={cx} y1={cy} x2={cx + Math.cos(rad(deg)) * len} y2={cy + Math.sin(rad(deg)) * len} />
  );
  return (
    <g className="clock-face">
      <circle className="clock-rim" cx={cx} cy={cy} r={r} />
      {face && (
        <>
          {face.numerals.map((n) => (
            <text
              key={n.angleDeg}
              className="clock-num"
              x={cx + Math.cos(rad(n.angleDeg)) * r * n.radius}
              y={cy + Math.sin(rad(n.angleDeg)) * r * n.radius}
              fontSize={(28 * r) / R}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {n.label}
            </text>
          ))}
          {hands && hand(face.hourAngle, r * 0.4, "clock-hour")}
          {hands && hand(face.minuteAngle, r * 0.6, "clock-minute")}
          {hands && <circle className="clock-pin" cx={cx} cy={cy} r={(6 * r) / R} />}
        </>
      )}
    </g>
  );
}

function facesFor(trial: ClockTrial): Record<StackPosition, Face> {
  return trial.correctPosition === "top"
    ? { top: trial.correct, bottom: trial.faulty }
    : { top: trial.faulty, bottom: trial.correct };
}

const other = (p: StackPosition): StackPosition => (p === "top" ? "bottom" : "top");

/* ------------------------------------------------------------------ intro */

/** A few untimed example pairs, one of each error type, for the "try one" card. Never recorded. */
function useExamples() {
  return useMemo(() => {
    const pool = generateClockTrials(12, 90210);
    const pickType = (t: ClockTrial["errorType"]) => pool.find((x) => x.errorType === t)!;
    return [pickType("missing"), pickType("swap"), pickType("shift")];
  }, []);
}

function TryOne() {
  const examples = useExamples();
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<StackPosition | null>(null);
  const trial = examples[i % examples.length]!;
  const faces = facesFor(trial);
  const right = pick === trial.correctPosition;

  const choose = (p: StackPosition) => setPick((current) => current ?? p);

  return (
    <figure className="clock-try">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="stack-board"
        role="group"
        aria-label="Example: two clocks, one drawn with a mistake"
        onPointerDown={(e) => choose(pointerToChoice(e.currentTarget, e.clientX, e.clientY, SPLIT_Y))}
      >
        <rect className="board-surface" x={1} y={1} width={W - 2} height={H - 2} rx={22} />
        {(["top", "bottom"] as const).map((p) => (
          <g key={p}>
            <ClockFace cx={CX} cy={CY[p]} face={faces[p]} />
            {pick && <circle className={`stack-pick ${p === trial.correctPosition ? "right" : "wrong"}`} cx={CX} cy={CY[p]} r={R + 14} />}
          </g>
        ))}
        <line className="stack-divider" x1={CX - 40} x2={CX + 40} y1={SPLIT_Y} y2={SPLIT_Y} />
      </svg>
      <figcaption>
        <Eyebrow plain>Try one · untimed</Eyebrow>
        {pick === null ? (
          <>
            <p className="try-q">Which clock is drawn correctly?</p>
            <div className="try-buttons">
              <button onClick={() => choose("top")}>
                Top clock
              </button>
              <button onClick={() => choose("bottom")}>
                Bottom clock
              </button>
            </div>
          </>
        ) : (
          <div role="status">
            <p className={`try-q ${right ? "ok" : ""}`}>{right ? "Spot on." : "Not quite."}</p>
            <p className="small">
              The {other(trial.correctPosition)} clock has {trial.errorDetail}
              {right ? "." : `. The ${trial.correctPosition} one is drawn correctly.`} In the real run the clocks only stay up
              for {CLOCK_DEFAULTS.exposureMs / 1000} seconds.
            </p>
            <button
              className="ghost"
              onClick={() => {
                setPick(null);
                setI((n) => n + 1);
              }}
            >
              Another example
            </button>
          </div>
        )}
      </figcaption>
    </figure>
  );
}

export function ClockIntro({ count, step, onBegin, onCancel }: { count: number; step: string; onBegin: () => void; onCancel: () => void }) {
  const seconds = Math.round((count * (FIXATION_MS + CLOCK_DEFAULTS.exposureMs + 600)) / 1000 / 5) * 5;
  return (
    <section className="intro card narrow">
      <Eyebrow>{step} · Clock check</Eyebrow>
      <h1>Spot the clock that’s drawn right</h1>
      <p className="lede">
        Two clocks flash, one above the other. One has a small slip: a number swapped, missing, or pulled out of place. Pick
        the one without it.
      </p>
      <TryOne />
      <ul className="steps">
        <li>
          Watch the <strong>+</strong> in the middle. The clocks appear for {CLOCK_DEFAULTS.exposureMs / 1000} seconds, then
          go blank. You can still answer while they are blank.
        </li>
        <li>
          Press <kbd>↑</kbd> or <kbd>W</kbd> if the top clock is right, <kbd>↓</kbd> or <kbd>S</kbd> if the bottom one is. Or
          tap it.
        </li>
        <li>No feedback during the run. If unsure, go with your first impression.</li>
        <li>
          {count} pairs, about {seconds} seconds. Switching tabs pauses the run.
        </li>
      </ul>
      <div className="actions">
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary large" onClick={onBegin}>
          Start clock check
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- task */

interface TaskProps {
  trials: ClockTrial[];
  eyebrow: string;
  onFinish: (responses: ClockResponse[]) => void;
  onStop: () => void;
  /** Demo run: start on its own after a short pause instead of waiting for Start. */
  autoStart?: boolean;
}

export function ClockTask({ trials, eyebrow, onFinish, onStop, autoStart = false }: TaskProps) {
  const responses = useRef<ClockResponse[]>([]);
  const { phase, index, chosen, begin, respond } = useStackedTrials({
    count: trials.length,
    blankMs: FIXATION_MS,
    exposureMs: CLOCK_DEFAULTS.exposureMs,
    windowMs: CLOCK_DEFAULTS.exposureMs + CLOCK_DEFAULTS.responseTimeoutMs,
    onResponse: (i, choice, rtMs) => {
      responses.current = [...responses.current.filter((r) => r.trialId !== trials[i]!.id), { trialId: trials[i]!.id, choice, rtMs }];
    },
    onComplete: () => onFinish(responses.current),
    autoStartMs: autoStart ? 1600 : undefined,
  });

  const trial = trials[Math.min(index, trials.length - 1)]!;
  const faces = facesFor(trial);
  const showFaces = phase === "stimulus";
  const showRims = phase !== "blank" && phase !== "done";

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) return;
    e.preventDefault();
    respond(pointerToChoice(e.currentTarget, e.clientX, e.clientY, SPLIT_Y), e.timeStamp);
  };

  const live =
    phase === "stimulus" ? `Pair ${index + 1} of ${trials.length}: clocks shown` : phase === "mask" ? "Clocks hidden. Answer top or bottom." : "";

  return (
    <section className="task" aria-labelledby="task-title">
      <div className="task-head">
        <div>
          <Eyebrow plain>{eyebrow}</Eyebrow>
          <h1 id="task-title">Which clock is drawn correctly?</h1>
          <p className="lede">Keep your eyes on the middle. No feedback; first impressions are fine.</p>
        </div>
        <TrialDial done={phase === "done" ? trials.length : index} total={trials.length} label="Pair" />
      </div>

      <div className="board-frame stack-frame">
        <svg
          className="stack-board"
          viewBox={`0 0 ${W} ${H}`}
          role="application"
          aria-label="Two stacked clocks. Up or W for the top clock, Down or S for the bottom clock."
          aria-describedby="clock-live"
          onPointerDown={onPointerDown}
        >
          <rect className="board-surface" x={1} y={1} width={W - 2} height={H - 2} rx={22} />
          {phase === "blank" && (
            <text className="fixation" x={CX} y={SPLIT_Y} textAnchor="middle" dominantBaseline="central">
              +
            </text>
          )}
          {showRims &&
            (["top", "bottom"] as const).map((p) => (
              <g key={p}>
                <ClockFace cx={CX} cy={CY[p]} face={showFaces ? faces[p] : null} />
                {phase === "ack" && chosen === p && <circle className="stack-pick" cx={CX} cy={CY[p]} r={R + 14} />}
              </g>
            ))}
          {showRims && <line className="stack-divider" x1={CX - 40} x2={CX + 40} y1={SPLIT_Y} y2={SPLIT_Y} />}
        </svg>
        <StartOverlay
          phase={phase}
          onBegin={begin}
          auto={autoStart}
          ready={`${trials.length} pairs. Eyes on the middle.`}
          paused="Paused while the tab was hidden. That pair will be shown again."
        />
      </div>
      <KeyHints top="top clock" bottom="bottom clock" />
      <p id="clock-live" className="sr-only" aria-live="polite">
        {live}
      </p>

      <div className="task-actions">
        <button className="ghost" onClick={onStop}>
          Stop
        </button>
      </div>
    </section>
  );
}
