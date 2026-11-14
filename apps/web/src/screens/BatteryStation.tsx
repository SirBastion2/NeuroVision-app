import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CLOCK_DEFAULTS,
  GREYSCALES_DEFAULTS,
  SCENE_DEFAULTS,
  generateBisectionLines,
  generateClockTrials,
  generateGreyscalesTrials,
  generateScene,
  type BarPosition,
  type BisectionLine,
  type BisectionResponse,
  type ClockFace,
  type ClockResponse,
  type ClockTrial,
  type GreyscalesResponse,
  type GreyscalesTrial,
  type SceneTap,
  type StackPosition,
} from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import type { BatteryIntroConfig, BatteryStep } from "../data/batterySession";

interface SceneProps {
  config: BatteryIntroConfig;
  onDone: (taps: SceneTap[]) => void;
}

interface ClockProps {
  config: BatteryIntroConfig;
  onDone: (trials: ClockTrial[], responses: ClockResponse[]) => void;
}

interface GreyProps {
  config: BatteryIntroConfig;
  onDone: (trials: GreyscalesTrial[], responses: GreyscalesResponse[]) => void;
}

interface LineProps {
  config: BatteryIntroConfig;
  onDone: (lines: BisectionLine[], responses: BisectionResponse[]) => void;
}

export const BATTERY_STEP_TITLE: Record<BatteryStep, string> = {
  scene: "Starry Night",
  clock: "Clock check",
  greyscales: "Greyscales",
  bisection: "Line bisection",
};

function svgPoint(svg: SVGSVGElement, event: PointerEvent<SVGSVGElement>) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const mapped = point.matrixTransform(ctm.inverse());
  return { x: mapped.x, y: mapped.y };
}

function ClockFaceView({ face, label }: { face: ClockFace; label: string }) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.4;
  const hand = (angle: number, length: number) => {
    const rad = (angle * Math.PI) / 180;
    return { x2: cx + Math.cos(rad) * r * length, y2: cy + Math.sin(rad) * r * length };
  };
  const hour = hand(face.hourAngle, 0.55);
  const minute = hand(face.minuteAngle, 0.82);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="hero-board" role="img" aria-label={label}>
      <circle className="hero-plate" cx={cx} cy={cy} r={r + 8} />
      {face.numerals.map((numeral) => {
        const rad = (numeral.angleDeg * Math.PI) / 180;
        const x = cx + Math.cos(rad) * r * numeral.radius;
        const y = cy + Math.sin(rad) * r * numeral.radius;
        return (
          <text key={`${numeral.label}-${numeral.angleDeg}`} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="14">
            {numeral.label}
          </text>
        );
      })}
      <line x1={cx} y1={cy} x2={hour.x2} y2={hour.y2} stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={minute.x2} y2={minute.y2} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function SceneStation({ config, onDone }: SceneProps) {
  const scene = useMemo(
    () => generateScene({ seed: config.seed, hide: config.hide }),
    [config.hide, config.seed],
  );
  const [taps, setTaps] = useState<SceneTap[]>([]);
  const onset = useRef(performance.now());
  const width = scene.visible.x1 - scene.visible.x0;
  const demo = config.mode === "demo";

  const pointer = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const point = svgPoint(svg, event);
    setTaps((current) => [...current, { t: performance.now() - onset.current, x: point.x, y: point.y }]);
  };

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <Eyebrow>{demo ? "Hidden scene · demo" : "Starry Night"}</Eyebrow>
          <h1>{demo ? "Find the lit lanterns you can see" : "Find every lit lantern"}</h1>
          <p className="lede">
            {demo
              ? "This short demo hides one side of the harbor. It is not saved."
              : "Tap each lit lantern. Unlit lanterns and windows are distractors."}
          </p>
        </div>
      </header>
      <svg
        className="hero-board"
        viewBox={`${scene.visible.x0} 0 ${width} ${scene.height}`}
        role="img"
        aria-label="Night harbor scene"
        onPointerDown={pointer}
        style={{ width: "100%", maxHeight: 420, cursor: "crosshair" }}
      >
        <rect x={scene.visible.x0} y={0} width={width} height={scene.height} fill="var(--accent)" opacity={0.18} />
        {scene.stars.map((star, index) => (
          <circle key={`s-${index}`} cx={star.x} cy={star.y} r={star.r} fill="var(--star)" />
        ))}
        <circle cx={scene.moon.x} cy={scene.moon.y} r={scene.moon.r} fill="var(--brass)" opacity={0.7} />
        {scene.buildings.map((building, index) => (
          <g key={`b-${index}`}>
            <rect x={building.x} y={scene.groundY - building.h} width={building.w} height={building.h} fill="var(--ink)" opacity={0.45} />
            {building.windows.map((window, w) => (
              <rect
                key={`w-${index}-${w}`}
                x={window.x}
                y={window.y}
                width={window.w}
                height={window.h}
                fill={window.lit ? "var(--brass)" : "var(--ink-2)"}
                opacity={window.lit ? 0.9 : 0.4}
              />
            ))}
          </g>
        ))}
        {scene.posts.map((x, index) => (
          <rect key={`p-${index}`} x={x - 2} y={scene.groundY - 70} width={4} height={70} fill="var(--ink)" />
        ))}
        {scene.lanterns
          .filter((lantern) => lantern.x >= scene.visible.x0 && lantern.x <= scene.visible.x1)
          .map((lantern) => (
            <circle
              key={lantern.id}
              cx={lantern.x}
              cy={lantern.y}
              r={10}
              fill={lantern.lit ? "var(--star)" : "var(--muted)"}
              stroke="var(--ink)"
              strokeWidth={2}
            />
          ))}
        <line x1={scene.visible.x0} x2={scene.visible.x1} y1={scene.groundY} y2={scene.groundY} stroke="var(--line)" strokeWidth={8} />
        {taps.map((tap, index) => (
          <circle key={index} cx={tap.x} cy={tap.y} r={6} fill="none" stroke="var(--found)" strokeWidth={2} />
        ))}
      </svg>
      <p className="fineprint">{taps.length} taps · {SCENE_DEFAULTS.searchCapMs / 1000}s cap</p>
      <div className="actions">
        <button className="primary large" type="button" onClick={() => onDone(taps)}>
          Done
        </button>
      </div>
    </div>
  );
}

export function ClockStation({ config, onDone }: ClockProps) {
  const trials = useMemo(
    () => generateClockTrials(config.mode === "demo" ? CLOCK_DEFAULTS.demoTrials : CLOCK_DEFAULTS.fullTrials, config.seed),
    [config.mode, config.seed],
  );
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<ClockResponse[]>([]);
  const [visible, setVisible] = useState(true);
  const shownAt = useRef(performance.now());
  const finished = useRef(false);
  const trial = trials[index];
  const chooseRef = useRef<(choice: StackPosition | null) => void>(() => undefined);

  const choose = (choice: StackPosition | null) => {
    if (!trial || finished.current) return;
    const next = [...responses, { trialId: trial.id, choice, rtMs: performance.now() - shownAt.current }];
    if (index + 1 >= trials.length) {
      finished.current = true;
      onDone(trials, next);
    }
    else {
      setResponses(next);
      setIndex(index + 1);
    }
  };
  chooseRef.current = choose;

  useEffect(() => {
    setVisible(true);
    shownAt.current = performance.now();
    const hide = window.setTimeout(() => setVisible(false), CLOCK_DEFAULTS.exposureMs);
    const skip = window.setTimeout(() => chooseRef.current(null), CLOCK_DEFAULTS.exposureMs + CLOCK_DEFAULTS.responseTimeoutMs);
    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(skip);
    };
  }, [index]);

  if (!trial) return null;
  const top = trial.correctPosition === "top" ? trial.correct : trial.faulty;
  const bottom = trial.correctPosition === "bottom" ? trial.correct : trial.faulty;

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <Eyebrow>Clock check · {index + 1} of {trials.length}</Eyebrow>
          <h1>Which clock is correct?</h1>
          <p className="lede">The faces are shown briefly, then masked. Pick the intact clock.</p>
        </div>
      </header>
      <div className="demo-grid">
        {visible ? (
          <>
            <button className="card demo-card" type="button" onClick={() => choose("top")}>
              <ClockFaceView face={top} label="Top clock" />
              <strong>Top</strong>
            </button>
            <button className="card demo-card" type="button" onClick={() => choose("bottom")}>
              <ClockFaceView face={bottom} label="Bottom clock" />
              <strong>Bottom</strong>
            </button>
          </>
        ) : (
          <p className="notice">Choose top or bottom from memory.</p>
        )}
      </div>
      {!visible && (
        <div className="actions">
          <button className="primary" type="button" onClick={() => choose("top")}>
            Top
          </button>
          <button className="primary" type="button" onClick={() => choose("bottom")}>
            Bottom
          </button>
        </div>
      )}
    </div>
  );
}

export function GreyscalesStation({ config, onDone }: GreyProps) {
  const trials = useMemo(() => generateGreyscalesTrials(GREYSCALES_DEFAULTS.trials, config.seed), [config.seed]);
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<GreyscalesResponse[]>([]);
  const shownAt = useRef(performance.now());
  const finished = useRef(false);
  const trial = trials[index];
  const chooseRef = useRef<(choice: BarPosition | null) => void>(() => undefined);

  const choose = (choice: BarPosition | null) => {
    if (!trial || finished.current) return;
    const next = [...responses, { trialId: trial.id, choice, rtMs: performance.now() - shownAt.current }];
    if (index + 1 >= trials.length) {
      finished.current = true;
      onDone(trials, next);
    }
    else {
      setResponses(next);
      setIndex(index + 1);
    }
  };
  chooseRef.current = choose;

  useEffect(() => {
    shownAt.current = performance.now();
    const skip = window.setTimeout(() => chooseRef.current(null), GREYSCALES_DEFAULTS.responseTimeoutMs);
    return () => window.clearTimeout(skip);
  }, [index]);

  if (!trial) return null;
  const top = trial.topDarkSide === "left" ? "to right" : "to left";
  const bottom = trial.topDarkSide === "left" ? "to left" : "to right";

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <Eyebrow>Greyscales · {index + 1} of {trials.length}</Eyebrow>
          <h1>Which bar looks darker overall?</h1>
          <p className="lede">Two gradients, one above the other. Choose the darker bar.</p>
        </div>
      </header>
      <div className="card" style={{ display: "grid", gap: 18, padding: 24 }}>
        <button type="button" className="ghost" onClick={() => choose("top")} aria-label="Top bar">
          <span
            style={{
              display: "block",
              height: GREYSCALES_DEFAULTS.barHeightPx,
              borderRadius: 8,
              background: `linear-gradient(${top}, #111, #f4f0e6)`,
            }}
          />
        </button>
        <button type="button" className="ghost" onClick={() => choose("bottom")} aria-label="Bottom bar">
          <span
            style={{
              display: "block",
              height: GREYSCALES_DEFAULTS.barHeightPx,
              borderRadius: 8,
              background: `linear-gradient(${bottom}, #111, #f4f0e6)`,
            }}
          />
        </button>
      </div>
    </div>
  );
}

export function BisectionStation({ config, onDone }: LineProps) {
  const lines = useMemo(() => generateBisectionLines(6, config.seed), [config.seed]);
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<BisectionResponse[]>([]);
  const line = lines[index];

  const mark = (event: PointerEvent<SVGSVGElement>) => {
    if (!line) return;
    const point = svgPoint(event.currentTarget, event);
    const next = [...responses, { lineId: line.id, x: point.x }];
    if (index + 1 >= lines.length) onDone(lines, next);
    else {
      setResponses(next);
      setIndex(index + 1);
    }
  };

  if (!line) return null;

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <Eyebrow>Line bisection · {index + 1} of {lines.length}</Eyebrow>
          <h1>Mark the middle of the line</h1>
          <p className="lede">One mark. No accuracy feedback.</p>
        </div>
      </header>
      <svg
        className="hero-board"
        viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        role="img"
        aria-label="Line bisection board"
        onPointerDown={mark}
        style={{ width: "100%", maxHeight: 360, cursor: "crosshair" }}
      >
        <rect className="hero-plate" width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={22} />
        <line x1={line.x1} x2={line.x2} y1={line.y} y2={line.y} stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      </svg>
    </div>
  );
}
