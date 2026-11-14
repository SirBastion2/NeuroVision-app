import { useId, useRef, useState, type PointerEvent } from "react";
import {
  GREYSCALES_DEFAULTS,
  type DarkSide,
  type GreyscalesResponse,
  type GreyscalesTrial,
  type ReadingDirection,
  type StackPosition,
} from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import { KeyHints, StartOverlay, TrialDial } from "./StackedTask";
import { pointerToChoice, useStackedTrials } from "./stackedTrials";

/*
 * Stimulus geometry from the greyscales spec: two 640 × 56 bars, 48 apart, on a
 * fixed mid-grey field. The field and the black-to-white ramps are set in
 * styles.css (`.grey-field`, `.grey-stop-*`) and deliberately ignore the theme:
 * the measurement depends on them being identical on every run.
 */
const W = 720;
const H = 220;
const BAR = { x: 40, w: GREYSCALES_DEFAULTS.barWidthPx, h: GREYSCALES_DEFAULTS.barHeightPx };
const BAR_Y: Record<StackPosition, number> = { top: 30, bottom: 30 + BAR.h + 48 };
const SPLIT_Y = H / 2;
const BLANK_MS = 400;

const mirror = (s: DarkSide): DarkSide => (s === "left" ? "right" : "left");

export const READING_LABELS: Record<ReadingDirection, { label: string; hint: string }> = {
  "left-to-right": { label: "Left to right", hint: "e.g. English, Spanish, Hindi" },
  "right-to-left": { label: "Right to left", hint: "e.g. Arabic, Hebrew, Urdu" },
  "both-or-other": { label: "Both or other", hint: "e.g. bilingual, vertical scripts" },
};

/** The two bars. The bottom one is always the exact mirror of the top one. */
function Bars({ topDark, hidden = false }: { topDark: DarkSide; hidden?: boolean }) {
  const id = useId().replace(/:/g, "");
  const ramp = (key: string, darkLeft: boolean) => (
    <linearGradient id={`${id}-${key}`} x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" className={darkLeft ? "grey-stop-dark" : "grey-stop-light"} />
      <stop offset="1" className={darkLeft ? "grey-stop-light" : "grey-stop-dark"} />
    </linearGradient>
  );
  if (hidden) return null;
  return (
    <>
      <defs>
        {ramp("top", topDark === "left")}
        {ramp("bottom", mirror(topDark) === "left")}
      </defs>
      <rect x={BAR.x} y={BAR_Y.top} width={BAR.w} height={BAR.h} fill={`url(#${id}-top)`} />
      <rect x={BAR.x} y={BAR_Y.bottom} width={BAR.w} height={BAR.h} fill={`url(#${id}-bottom)`} />
    </>
  );
}

function Field({ children, ...rest }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} {...rest}>
      <rect className="grey-field" x={0} y={0} width={W} height={H} rx={14} />
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------------ intro */

function MirrorDemo() {
  const [topDark, setTopDark] = useState<DarkSide>("left");
  return (
    <figure className="grey-try">
      <Field className="grey-board" aria-label="Example: two shaded bars that are mirror images of each other" role="img">
        <Bars topDark={topDark} />
      </Field>
      <figcaption>
        <p className="small">
          These two bars are mirror images, so they hold exactly the same amount of dark. Most people still see one as darker.
          Which one looks darker to you is the whole test.
        </p>
        <button className="ghost" onClick={() => setTopDark(mirror)}>
          Mirror them
        </button>
      </figcaption>
    </figure>
  );
}

interface IntroProps {
  count: number;
  step: string;
  initialDirection: ReadingDirection | null;
  onBegin: (direction: ReadingDirection) => void;
  onCancel: () => void;
}

export function GreyscalesIntro({ count, step, initialDirection, onBegin, onCancel }: IntroProps) {
  const [direction, setDirection] = useState<ReadingDirection | null>(initialDirection);
  const [error, setError] = useState(false);
  const errorId = useId();

  return (
    <section className="intro card narrow">
      <Eyebrow>{step} · Greyscales</Eyebrow>
      <h1>Which bar looks darker?</h1>
      <p className="lede">There’s no right answer. Go with your first impression, every time.</p>
      <MirrorDemo />

      <fieldset className="field" aria-describedby={error ? errorId : undefined} aria-invalid={error || undefined}>
        <legend>Which way do you mostly read?</legend>
        <div className="segmented">
          {(Object.keys(READING_LABELS) as ReadingDirection[]).map((d) => (
            <label key={d} className={direction === d ? "on" : ""} title={READING_LABELS[d].hint}>
              <input
                type="radio"
                name="reading"
                value={d}
                checked={direction === d}
                onChange={() => {
                  setDirection(d);
                  setError(false);
                }}
              />
              {READING_LABELS[d].label}
            </label>
          ))}
        </div>
        <small>{direction ? READING_LABELS[direction].hint : "Reading habits shift the natural lean, so the comparison uses yours."}</small>
        {error && (
          <p id={errorId} className="notice error" role="alert">
            Choose a reading direction to continue.
          </p>
        )}
      </fieldset>

      <ul className="steps">
        <li>
          Press <kbd>↑</kbd> or <kbd>W</kbd> for the top bar, <kbd>↓</kbd> or <kbd>S</kbd> for the bottom one. Or tap it.
        </li>
        <li>Look as long as you like, up to {GREYSCALES_DEFAULTS.responseTimeoutMs / 1000} seconds per pair.</li>
        <li>
          {count} pairs, about {Math.round((count * 1.8) / 10) * 10} seconds. Switching tabs pauses the run.
        </li>
      </ul>
      <div className="actions">
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary large"
          onClick={() => {
            if (!direction) return setError(true);
            onBegin(direction);
          }}
        >
          Start greyscales
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- task */

interface TaskProps {
  trials: GreyscalesTrial[];
  eyebrow: string;
  onFinish: (responses: GreyscalesResponse[]) => void;
  onStop: () => void;
  /** Demo run: start on its own after a short pause instead of waiting for Start. */
  autoStart?: boolean;
}

export function GreyscalesTask({ trials, eyebrow, onFinish, onStop, autoStart = false }: TaskProps) {
  const responses = useRef<GreyscalesResponse[]>([]);
  const { phase, index, chosen, begin, respond } = useStackedTrials({
    count: trials.length,
    blankMs: BLANK_MS,
    windowMs: GREYSCALES_DEFAULTS.responseTimeoutMs,
    ackMs: 180,
    onResponse: (i, choice, rtMs) => {
      responses.current = [...responses.current.filter((r) => r.trialId !== trials[i]!.id), { trialId: trials[i]!.id, choice, rtMs }];
    },
    onComplete: () => onFinish(responses.current),
    autoStartMs: autoStart ? 1600 : undefined,
  });

  const trial = trials[Math.min(index, trials.length - 1)]!;

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) return;
    e.preventDefault();
    respond(pointerToChoice(e.currentTarget, e.clientX, e.clientY, SPLIT_Y), e.timeStamp);
  };

  return (
    <section className="task" aria-labelledby="task-title">
      <div className="task-head">
        <div>
          <Eyebrow plain>{eyebrow}</Eyebrow>
          <h1 id="task-title">Which bar looks darker overall?</h1>
          <p className="lede">No right answer. First impressions are exactly what we want.</p>
        </div>
        <TrialDial done={phase === "done" ? trials.length : index} total={trials.length} label="Pair" />
      </div>

      <div className="board-frame grey-frame">
        <Field
          className="grey-board"
          role="application"
          aria-label="Two shaded bars. Up or W for the top bar, Down or S for the bottom bar."
          aria-describedby="grey-live"
          onPointerDown={onPointerDown}
        >
          <Bars topDark={trial.topDarkSide} hidden={phase !== "stimulus"} />
          {phase === "ack" && chosen && (
            <rect className="grey-pick" x={BAR.x - 6} y={BAR_Y[chosen] - 6} width={BAR.w + 12} height={BAR.h + 12} rx={8} />
          )}
        </Field>
        <StartOverlay
          phase={phase}
          onBegin={begin}
          auto={autoStart}
          ready={`${trials.length} pairs. Trust your eyes.`}
          paused="Paused while the tab was hidden. That pair will be shown again."
        />
      </div>
      <KeyHints top="top bar" bottom="bottom bar" />
      <p id="grey-live" className="sr-only" aria-live="polite">
        {phase === "stimulus" ? `Pair ${index + 1} of ${trials.length}` : ""}
      </p>

      <div className="task-actions">
        <button className="ghost" onClick={onStop}>
          Stop
        </button>
      </div>
    </section>
  );
}
