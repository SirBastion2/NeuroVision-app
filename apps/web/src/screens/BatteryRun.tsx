import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLOCK_DEFAULTS,
  GREYSCALES_DEFAULTS,
  generateBisectionLines,
  generateClockTrials,
  generateGreyscalesTrials,
  toBoardCoordinates,
  type BisectionLine,
  type BisectionResponse,
  type ClockResponse,
  type GreyscalesResponse,
  type ReadingDirection,
  type ResponseEvent,
  type TrialRecord,
} from "@neurovision/domain";
import { ClockIntro, ClockTask } from "../checks/ClockTask";
import { GreyscalesIntro, GreyscalesTask } from "../checks/GreyscalesTask";
import { Board, ResponseMarks } from "../components/Board";
import { Eyebrow } from "../components/Brand";
import {
  runnableBatterySteps,
  saveBatterySession,
  type BatteryIntroConfig,
  type BatteryStep,
  type BatteryStoreOptions,
  type BatteryTaskOutputs,
} from "../data/batterySession";
import { TIME_LIMIT_MS } from "../lib/session";

export type BatteryRunningChange = (running: boolean) => void;

interface Props {
  config: BatteryIntroConfig;
  onFinished: (record: Awaited<ReturnType<typeof saveBatterySession>>) => void;
  onStop: () => void;
  onRunning?: BatteryRunningChange;
  storeOptions?: BatteryStoreOptions;
}

type Phase = "intro" | "run";

function stepLabel(step: BatteryStep, index: number, total: number): string {
  const names: Record<BatteryStep, string> = {
    scene: "Scene search",
    clock: "Clock check",
    greyscales: "Greyscales",
    bisection: "Line bisection",
  };
  return `Test ${index + 1} of ${total} · ${names[step]}`;
}

export function BatteryRun({ config, onFinished, onStop, onRunning, storeOptions }: Props) {
  const steps = useMemo(() => runnableBatterySteps(config.mode), [config.mode]);
  const startedAt = useRef(new Date().toISOString());
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [direction, setDirection] = useState<ReadingDirection | null>(config.readingDirection);
  const [clockResponses, setClockResponses] = useState<ClockResponse[]>([]);
  const [greyResponses, setGreyResponses] = useState<GreyscalesResponse[]>([]);
  const [bisectionResponses, setBisectionResponses] = useState<BisectionResponse[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const finishing = useRef(false);

  const clockCount = config.mode === "demo" ? CLOCK_DEFAULTS.demoTrials : CLOCK_DEFAULTS.fullTrials;
  const clockTrials = useMemo(() => generateClockTrials(clockCount, config.seed), [clockCount, config.seed]);
  const greyTrials = useMemo(
    () => generateGreyscalesTrials(GREYSCALES_DEFAULTS.trials, config.seed),
    [config.seed],
  );
  const lines = useMemo(() => generateBisectionLines(6, config.seed), [config.seed]);

  const step = steps[index];
  const running = phase === "run" && step != null;
  useEffect(() => onRunning?.(running), [running, onRunning]);
  useEffect(() => () => onRunning?.(false), [onRunning]);

  const persist = useCallback(
    async (clock: ClockResponse[], greyscales: GreyscalesResponse[], bisection: BisectionResponse[]) => {
      if (finishing.current) return;
      finishing.current = true;
      setSaving(true);
      setSaveError(null);
      const outputs: BatteryTaskOutputs = {
        scene: { taps: [] },
        clock: { trials: clockTrials, responses: clock },
      };
      if (config.mode === "full") {
        outputs.greyscales = { trials: greyTrials, responses: greyscales };
        outputs.bisection = { lines, responses: bisection };
      }
      try {
        const record = await saveBatterySession(
          { ...config, readingDirection: direction ?? config.readingDirection },
          outputs,
          { ...storeOptions, startedAt: startedAt.current, completedAt: new Date().toISOString() },
        );
        onFinished(record);
      } catch (error) {
        finishing.current = false;
        setSaveError(error instanceof Error ? error.message : String(error));
        setSaving(false);
      }
    },
    [clockTrials, config, direction, greyTrials, lines, onFinished, storeOptions],
  );

  const advance = useCallback(
    (clock: ClockResponse[], greyscales: GreyscalesResponse[], bisection: BisectionResponse[]) => {
      const next = index + 1;
      if (next >= steps.length) {
        void persist(clock, greyscales, bisection);
        return;
      }
      setIndex(next);
      setPhase("intro");
    },
    [index, persist, steps.length],
  );

  useEffect(() => {
    if (steps.length === 0) void persist([], [], []);
  }, [persist, steps.length]);

  if (saving) {
    return (
      <section className="intro card narrow">
        <Eyebrow>Spatial battery</Eyebrow>
        <h1>Saving this run</h1>
        <p className="lede">Recomputing scores from the raw responses.</p>
      </section>
    );
  }

  if (saveError) {
    return (
      <section className="intro card narrow">
        <Eyebrow>Spatial battery</Eyebrow>
        <h1>Could not save</h1>
        <p className="notice error" role="alert">
          {saveError}
        </p>
        <div className="actions">
          <button className="ghost" type="button" onClick={onStop}>
            Home
          </button>
        </div>
      </section>
    );
  }

  if (!step) {
    return (
      <section className="intro card narrow">
        <Eyebrow>Spatial battery</Eyebrow>
        <h1>Finishing</h1>
      </section>
    );
  }

  const eyebrow = stepLabel(step, index, steps.length);

  if (step === "clock" && phase === "intro") {
    return (
      <ClockIntro count={clockTrials.length} step={eyebrow} onBegin={() => setPhase("run")} onCancel={onStop} />
    );
  }
  if (step === "clock") {
    return (
      <ClockTask
        trials={clockTrials}
        eyebrow={eyebrow}
        onFinish={(responses) => {
          setClockResponses(responses);
          advance(responses, greyResponses, bisectionResponses);
        }}
        onStop={onStop}
      />
    );
  }

  if (step === "greyscales" && phase === "intro") {
    return (
      <GreyscalesIntro
        count={greyTrials.length}
        step={eyebrow}
        initialDirection={direction}
        onBegin={(next) => {
          setDirection(next);
          setPhase("run");
        }}
        onCancel={onStop}
      />
    );
  }
  if (step === "greyscales") {
    return (
      <GreyscalesTask
        trials={greyTrials}
        eyebrow={eyebrow}
        onFinish={(responses) => {
          setGreyResponses(responses);
          advance(clockResponses, responses, bisectionResponses);
        }}
        onStop={onStop}
      />
    );
  }

  if (step === "bisection" && phase === "intro") {
    return (
      <section className="intro card narrow">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1>Mark the middle of each line</h1>
        <p className="lede">One mark per line. There is no accuracy feedback.</p>
        <ul className="steps">
          <li>Each line has up to {TIME_LIMIT_MS["line-bisection"] / 1000} seconds.</li>
          <li>{lines.length} lines in total.</li>
        </ul>
        <div className="actions">
          <button className="ghost" type="button" onClick={onStop}>
            Cancel
          </button>
          <button className="primary large" type="button" onClick={() => setPhase("run")} autoFocus>
            Start line bisection
          </button>
        </div>
      </section>
    );
  }

  return (
    <BatteryBisection
      lines={lines}
      eyebrow={eyebrow}
      onFinish={(responses) => {
        setBisectionResponses(responses);
        advance(clockResponses, greyResponses, responses);
      }}
      onStop={onStop}
    />
  );
}

function BatteryBisection({
  lines,
  eyebrow,
  onFinish,
  onStop,
}: {
  lines: BisectionLine[];
  eyebrow: string;
  onFinish: (responses: BisectionResponse[]) => void;
  onStop: () => void;
}) {
  const [lineIndex, setLineIndex] = useState(0);
  const collected = useRef<BisectionResponse[]>([]);
  const line = lines[lineIndex]!;

  return (
    <BatteryBisectionLine
      key={line.id}
      line={line}
      index={lineIndex}
      total={lines.length}
      eyebrow={eyebrow}
      onFinish={(response) => {
        collected.current = [...collected.current, response];
        if (lineIndex + 1 >= lines.length) onFinish(collected.current);
        else setLineIndex(lineIndex + 1);
      }}
      onStop={onStop}
    />
  );
}

function BatteryBisectionLine({
  line,
  index,
  total,
  eyebrow,
  onFinish,
  onStop,
}: {
  line: BisectionLine;
  index: number;
  total: number;
  eyebrow: string;
  onFinish: (response: BisectionResponse) => void;
  onStop: () => void;
}) {
  const board = useRef<SVGSVGElement>(null);
  const onset = useRef<number | null>(null);
  const closed = useRef(false);
  const markRef = useRef<number | null>(null);
  const [markX, setMarkX] = useState<number | null>(null);
  const timeLimitMs = TIME_LIMIT_MS["line-bisection"];
  const [remaining, setRemaining] = useState<number>(timeLimitMs);

  const finish = useCallback(
    (end: TrialRecord["end"]) => {
      if (closed.current) return;
      closed.current = true;
      const x = end === "done" ? markRef.current : null;
      onFinish({ lineId: line.id, x });
    },
    [line.id, onFinish],
  );

  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        onset.current = performance.now();
        board.current?.focus();
      });
    });
    const timer = window.setInterval(() => {
      if (onset.current === null || closed.current) return;
      const left = timeLimitMs - (performance.now() - onset.current);
      setRemaining(Math.max(0, left));
      if (left <= 0) finish("timeout");
    }, 100);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.clearInterval(timer);
    };
  }, [finish, timeLimitMs]);

  const secondsLeft = Math.ceil(remaining / 1000);
  const tick: ResponseEvent[] =
    markX == null
      ? []
      : [
          {
            sessionId: "battery",
            trialId: line.id,
            seq: 1,
            elapsed: 0,
            x: markX,
            y: line.y,
            type: "bisection",
            stimulusId: null,
          },
        ];

  return (
    <section className="task" aria-labelledby="task-title">
      <div className="task-head">
        <div>
          <Eyebrow plain>{eyebrow}</Eyebrow>
          <h1 id="task-title">Mark the middle of the line</h1>
          <p className="lede">
            Line {index + 1} of {total}. One mark. No accuracy feedback.
          </p>
        </div>
        <div className={`timer ${secondsLeft <= 10 ? "low" : ""}`} aria-label={`${secondsLeft} seconds left`}>
          <svg viewBox="0 0 44 44" aria-hidden>
            <circle className="timer-track" cx="22" cy="22" r="19" />
            <circle
              className="timer-arc"
              cx="22"
              cy="22"
              r="19"
              pathLength={100}
              strokeDasharray={`${(100 * remaining) / timeLimitMs} 100`}
            />
          </svg>
          <span>{secondsLeft}</span>
        </div>
      </div>
      <div className="board-frame">
        <Board
          ref={board}
          label={`Line ${index + 1} of ${total}`}
          role="application"
          tabIndex={0}
          line={{ x1: line.x1, y: line.y, x2: line.x2 }}
          onPointerDown={(event) => {
            if (!event.isPrimary || markRef.current != null) return;
            event.preventDefault();
            const point = toBoardCoordinates(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
            markRef.current = point.x;
            setMarkX(point.x);
          }}
        >
          <ResponseMarks events={tick} />
        </Board>
      </div>
      <div className="task-actions">
        <button className="ghost" type="button" onClick={onStop}>
          Stop
        </button>
        <button className="ghost" type="button" onClick={() => finish("skip")} disabled={markX != null}>
          Skip line
        </button>
        <button className="primary" type="button" onClick={() => finish("done")} disabled={markX == null}>
          {index + 1 >= total ? "Finish" : "Next line"}
        </button>
      </div>
    </section>
  );
}
