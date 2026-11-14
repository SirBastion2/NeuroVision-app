import { computeSessionMetrics } from "../metrics";
import {
  SESSION_SCHEMA,
  type Difficulty,
  type GazeQuality,
  type GazeSample,
  type GazeSourceKind,
  type SessionResult,
  type TapEvent,
  type TestLayout,
} from "../metrics/types";
import { markFixations } from "../gaze/fixations";

export interface BuildSessionInput {
  layout: TestLayout;
  difficulty: Difficulty;
  cued: boolean;
  source: GazeSourceKind;
  label: string;
  taps: TapEvent[];
  gaze: GazeSample[];
  quality: GazeQuality;
  durationMs: number;
  timedOut: boolean;
  createdAt?: Date;
  screen?: SessionResult["screen"];
  id?: string;
}

export function currentScreen(): SessionResult["screen"] {
  if (typeof window === "undefined") return { width: 0, height: 0, dpr: 1, screenWidth: 0, screenHeight: 0 };
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
  };
}

let counter = 0;
export function newSessionId(now = Date.now()): string {
  counter = (counter + 1) % 1000;
  return `scr-${now.toString(36)}-${counter.toString(36)}`;
}

/** Assembles a complete SessionResult, marking fixations and computing every metric. */
export function buildSession(input: BuildSessionInput): SessionResult {
  const gaze = markFixations(input.gaze);
  const quality = { ...input.quality };
  return {
    schema: SESSION_SCHEMA,
    id: input.id ?? newSessionId(),
    test: input.layout.kind,
    source: input.source,
    label: input.label,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    screen: input.screen ?? currentScreen(),
    layout: input.layout,
    difficulty: input.difficulty,
    cued: input.cued,
    taps: input.taps,
    gaze,
    metrics: computeSessionMetrics({
      layout: input.layout,
      taps: input.taps,
      gaze,
      durationMs: input.durationMs,
      timedOut: input.timedOut,
      quality,
    }),
    quality,
  };
}

/** Recomputes metrics, e.g. after toggling click refinement. Keeps duration and timeout. */
export function recomputeSession(s: SessionResult, gaze: GazeSample[], quality: GazeQuality): SessionResult {
  const t = s.metrics.test;
  return {
    ...s,
    gaze,
    quality,
    metrics: computeSessionMetrics({
      layout: s.layout,
      taps: s.taps,
      gaze,
      durationMs: t.durationMs,
      timedOut: t.kind === "star-cancellation" ? t.timedOut : false,
      quality,
    }),
  };
}
