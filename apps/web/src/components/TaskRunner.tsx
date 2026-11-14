import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  BOARD_HEIGHT,
  BOARD_ROWS,
  BOARD_WIDTH,
  cellPosition,
  classifyResponse,
  toBoardCoordinates,
  type PracticeSuggestion,
  type ResponseEvent,
  type TrialEndReason,
  type TrialRecord,
} from "@neurovision/domain";
import { Board, ResponseMarks, RowGuide, SideCue } from "./Board";
import { Eyebrow } from "./Brand";

interface Props {
  sessionId: string;
  trial: TrialRecord;
  timeLimitMs: number;
  eyebrow: string;
  title: string;
  instruction: string;
  /** Practice only. Assessment trials never receive a cue. */
  practice?: PracticeSuggestion;
  onFinish: (trial: TrialRecord) => void;
}

const KEY_STEP = 12;
const KEY_FINE_STEP = 2;

/**
 * Runs one trial on the logical board. Timing uses performance.now() from the
 * first painted frame; nothing here waits on storage or the network.
 * Interruptions (Stop, resize, hidden tab) end the trial with that reason.
 */
export function TaskRunner({ sessionId, trial, timeLimitMs, eyebrow, title, instruction, practice, onFinish }: Props) {
  const board = useRef<SVGSVGElement>(null);
  const onset = useRef<number | null>(null);
  const closed = useRef(false);
  const eventsRef = useRef<ResponseEvent[]>([]);
  const [events, setEvents] = useState<ResponseEvent[]>([]);
  const [ready, setReady] = useState(false);
  const [remaining, setRemaining] = useState(timeLimitMs);
  const [cursor, setCursor] = useState({ x: BOARD_WIDTH / 2, y: trial.line?.y ?? BOARD_HEIGHT / 2 });
  const [row, setRow] = useState(0);

  const isLine = trial.task === "line-bisection";
  const answered = isLine && events.some((e) => e.type === "bisection");
  const keyboard = trial.input === "keyboard";
  const rowGuide = !!practice?.scanGuide && practice.cue !== "none" && practice.level === 2;

  const finish = useCallback(
    (end: TrialEndReason) => {
      if (closed.current) return;
      closed.current = true;
      const started = onset.current ?? performance.now();
      const duration = Math.min(timeLimitMs, Math.max(0, performance.now() - started));
      onFinish({ ...trial, events: eventsRef.current, duration, end });
    },
    [onFinish, timeLimitMs, trial],
  );
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        onset.current = performance.now();
        setReady(true);
        board.current?.focus();
      });
    });
    const timer = window.setInterval(() => {
      if (onset.current === null || closed.current) return;
      const left = timeLimitMs - (performance.now() - onset.current);
      setRemaining(Math.max(0, left));
      if (left <= 0) finishRef.current("timeout");
    }, 100);
    const onResize = () => finishRef.current("resize");
    const onVisibility = () => document.hidden && finishRef.current("hidden");
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.clearInterval(timer);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [timeLimitMs]);

  const record = (x: number, y: number) => {
    if (onset.current === null || closed.current) return;
    if (isLine && eventsRef.current.some((e) => e.type === "bisection")) return;
    const elapsed = performance.now() - onset.current;
    if (elapsed >= timeLimitMs) return finish("timeout");
    const event = classifyResponse({
      sessionId,
      trialId: trial.id,
      task: trial.task,
      layout: trial.layout,
      line: trial.line,
      existing: eventsRef.current,
      point: { x, y },
      elapsed,
    });
    eventsRef.current = [...eventsRef.current, event];
    setEvents(eventsRef.current);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (keyboard || !e.isPrimary) return;
    // Each input modality is its own comparison group, so other pointer types are ignored.
    if ((trial.input === "touch") !== (e.pointerType === "touch")) return;
    e.preventDefault();
    const p = toBoardCoordinates(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    record(p.x, p.y);
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!keyboard) return;
    const step = e.shiftKey ? KEY_FINE_STEP : KEY_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setCursor((c) => ({
        x: Math.min(BOARD_WIDTH, Math.max(0, c.x + move[0])),
        y: Math.min(BOARD_HEIGHT, Math.max(0, c.y + move[1])),
      }));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      record(cursor.x, cursor.y);
    }
  };

  const secondsLeft = Math.ceil(remaining / 1000);
  const responses = events.filter((e) => e.type !== "pointer").length;

  return (
    <section className="task" aria-labelledby="task-title">
      <div className="task-head">
        <div>
          <Eyebrow plain>{eyebrow}</Eyebrow>
          <h1 id="task-title">{title}</h1>
          <p className="lede">
            {instruction}
            {keyboard && " Arrow keys move the cursor (Shift for small steps); Enter selects."}
          </p>
        </div>
        <div className={`timer ${secondsLeft <= 10 ? "low" : ""}`} aria-label={`${secondsLeft} seconds left`}>
          <svg viewBox="0 0 44 44" aria-hidden>
            <circle className="timer-track" cx="22" cy="22" r="19" />
            <circle className="timer-arc" cx="22" cy="22" r="19" pathLength={100} strokeDasharray={`${(100 * remaining) / timeLimitMs} 100`} />
          </svg>
          <span>{secondsLeft}</span>
        </div>
      </div>
      {rowGuide && (
        <p className="row-status" role="status">
          Row {row + 1} of {BOARD_ROWS}: start at the {practice!.cue} edge and scan across.
        </p>
      )}

      <div className="board-frame">
        <Board
          ref={board}
          label={isLine ? "Line bisection board" : "Hollow rings board: select hollow rings"}
          role="application"
          tabIndex={0}
          stimuli={trial.layout.stimuli}
          line={trial.line}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          aria-describedby="task-live"
        >
          {practice && <SideCue cue={practice.cue} level={practice.level} />}
          {rowGuide && <RowGuide y={cellPosition(0, row).y} />}
          <ResponseMarks events={events} />
          {keyboard && ready && (
            <g className="cursor" aria-hidden>
              <line x1={cursor.x - 14} x2={cursor.x + 14} y1={cursor.y} y2={cursor.y} />
              <line x1={cursor.x} x2={cursor.x} y1={cursor.y - 14} y2={cursor.y + 14} />
            </g>
          )}
        </Board>
        {!ready && <div className="board-wait">Get ready…</div>}
      </div>
      <p id="task-live" className="sr-only" aria-live="polite">
        {isLine ? (answered ? "Mark placed." : "") : `${responses} selections`}
      </p>

      <div className="task-actions">
        <button className="ghost" onClick={() => finish("stop")}>
          Stop
        </button>
        {rowGuide && (
          <button onClick={() => setRow((r) => Math.min(BOARD_ROWS - 1, r + 1))} disabled={row >= BOARD_ROWS - 1}>
            Next scan row
          </button>
        )}
        {isLine ? (
          <>
            <button className="ghost" onClick={() => finish("skip")} disabled={answered}>
              Skip line
            </button>
            <button className="primary" onClick={() => finish("done")} disabled={!answered}>
              Next line
            </button>
          </>
        ) : (
          <button className="primary" onClick={() => finish("done")} disabled={!ready}>
            Done
          </button>
        )}
      </div>
    </section>
  );
}
