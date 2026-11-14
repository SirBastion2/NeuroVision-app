import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Difficulty, GazeSample, TapEvent, TestLayout } from "../../metrics/types";
import type { GazeSource, TrackerStatus } from "../../gaze/types";
import { GazeWarnings } from "../../gaze/ui/FreeLook";
import { resolveBisectionTap } from "../bisection";
import { resolveStarTap } from "../star";
import { drawBisectionTest, drawStarTest, setupCanvas } from "./draw";

export interface TestRunResult {
  taps: TapEvent[];
  gaze: GazeSample[];
  durationMs: number;
  timedOut: boolean;
}

interface Props {
  layout: TestLayout;
  difficulty: Difficulty;
  cued: boolean;
  source: GazeSource | null;
  onFinish: (r: TestRunResult) => void;
  onAbort: () => void;
}

/** The fading left cue: a flashing bar on the left edge that disappears over 20 s. */
const CUE_FADE_MS = 20_000;

/**
 * Full-screen test page. Taps and gaze are recorded with `t` relative to the moment
 * the page appeared; gaze arrives in page coordinates, which equal test-area coordinates
 * because the test covers the whole viewport.
 */
export function TestRunner({ layout, difficulty, cued, source, onFinish, onAbort }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const t0 = useRef(performance.now());
  const taps = useRef<TapEvent[]>([]);
  const gaze = useRef<GazeSample[]>([]);
  const done = useRef(false);
  const [, force] = useState(0);
  const [status, setStatus] = useState<TrackerStatus>({ faceVisible: true, movedTooMuch: false, fps: null });
  const [remaining, setRemaining] = useState(difficulty.timeLimitMs);
  const [cueOpacity, setCueOpacity] = useState(cued ? 1 : 0);

  const colors = useRef({ paper: "#fffdf8", ink: "#1a2420" });

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = setupCanvas(c, layout.area.width, layout.area.height);
    if (layout.kind === "star-cancellation") drawStarTest(ctx, layout, taps.current, colors.current);
    else drawBisectionTest(ctx, layout, taps.current, colors.current);
  }, [layout]);

  const finish = useCallback(
    (timedOut: boolean) => {
      if (done.current) return;
      done.current = true;
      onFinish({ taps: taps.current, gaze: gaze.current, durationMs: Math.round(performance.now() - t0.current), timedOut });
    },
    [onFinish],
  );

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    colors.current = { paper: css.getPropertyValue("--board").trim() || "#fffdf8", ink: css.getPropertyValue("--stim").trim() || "#1a2420" };
    t0.current = performance.now();
    draw();
    const offs: Array<() => void> = [];
    if (source) {
      source.start();
      offs.push(source.subscribe((s) => gaze.current.push({ ...s, t: Math.round(s.t - t0.current) })));
      offs.push(source.subscribeStatus(setStatus));
    }
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - t0.current;
      setRemaining(Math.max(0, difficulty.timeLimitMs - elapsed));
      if (cued) setCueOpacity(Math.max(0, 1 - elapsed / CUE_FADE_MS));
      if (elapsed >= difficulty.timeLimitMs) finish(true);
    }, 200);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !done.current && ((done.current = true), onAbort());
    window.addEventListener("keydown", onKey);
    return () => {
      offs.forEach((o) => o());
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [source, draw, difficulty.timeLimitMs, cued, finish, onAbort]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (done.current || !e.isPrimary) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) * layout.area.width) / r.width;
    const y = ((e.clientY - r.top) * layout.area.height) / r.height;
    const t = Math.round(performance.now() - t0.current);
    const tap = layout.kind === "star-cancellation" ? resolveStarTap(layout, x, y, t, taps.current) : resolveBisectionTap(layout, x, y, t, taps.current);
    taps.current = [...taps.current, tap];
    draw();
    force((n) => n + 1);
  };

  const secs = Math.ceil(remaining / 1000);
  return createPortal(
    <div className="scr-test" role="application" aria-label={layout.kind === "star-cancellation" ? "Star cancellation test" : "Line bisection test"}>
      <canvas ref={canvas} onPointerDown={onPointerDown} className="scr-test-canvas" />
      {cued && cueOpacity > 0 && <div className="scr-cue" style={{ opacity: cueOpacity }} aria-hidden />}
      <div className="scr-test-bar">
        <button type="button" className="ghost" onClick={() => !done.current && ((done.current = true), onAbort())}>
          Stop
        </button>
        <span className="scr-test-hint">
          {layout.kind === "star-cancellation" ? "Cross out every small star." : "Tap the middle of each line."}
          <small> {secs}s</small>
        </span>
        <button type="button" className="primary large" onClick={() => finish(false)}>
          Done
        </button>
      </div>
      {source?.kind === "webcam" && <GazeWarnings status={status} />}
    </div>,
    document.body,
  );
}
