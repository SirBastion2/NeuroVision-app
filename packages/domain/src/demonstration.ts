import { classifyResponse, type ResponseEvent } from "./events.js";
import type { CalibrationQualityReport, GazeSample, GazeStream } from "./gaze.js";
import { createTargetSelectionLayout } from "./layouts.js";
import type { TrialRecord, Viewport } from "./session.js";

const VIEWPORT: Viewport = {
  width: 1280,
  height: 900,
  dpr: 1,
  class: "desktop-960",
};

const SAMPLE_MS = 100;
const GAZE_DURATION_MS = 22_000;
export const GAZE_LAB_TRACKING_GAPS = [
  { start: 6800, end: 9000 },
  { start: 15_500, end: 16_900 },
] as const;

function mixer(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function targetIds(side: "left" | "right", count: number): string[] {
  return createTargetSelectionLayout("fixed-a")
    .stimuli.filter((stimulus) => stimulus.kind === "target" && stimulus.side === side)
    .slice(0, count)
    .map((stimulus) => stimulus.id);
}

function eventsForIds(trial: TrialRecord, sessionId: string, ids: readonly string[]): ResponseEvent[] {
  const events: ResponseEvent[] = [];
  for (const [index, id] of ids.entries()) {
    const stimulus = trial.layout.stimuli.find((item) => item.id === id);
    if (!stimulus) throw new Error(`Missing stimulus ${id}`);
    events.push(
      classifyResponse({
        sessionId,
        trialId: trial.id,
        task: trial.task,
        layout: trial.layout,
        existing: events,
        point: { x: stimulus.x, y: stimulus.y },
        elapsed: 800 + index * 650,
      }),
    );
  }
  return events;
}

function targetTrial(sessionId: string, leftHits: number, rightHits: number): TrialRecord {
  const layout = createTargetSelectionLayout("fixed-a");
  const trial: TrialRecord = {
    id: `${sessionId}-target`,
    task: "target-selection",
    layout,
    events: [],
    duration: 22_000,
    end: "done",
    input: "mouse-trackpad",
    viewport: VIEWPORT,
  };
  trial.events = eventsForIds(trial, sessionId, [...targetIds("left", leftHits), ...targetIds("right", rightHits)]);
  return trial;
}

function inGap(elapsed: number): boolean {
  return GAZE_LAB_TRACKING_GAPS.some((gap) => elapsed >= gap.start && elapsed < gap.end);
}

function gazeSamples(wide: boolean): GazeSample[] {
  const next = mixer(wide ? 802 : 801);
  const samples: GazeSample[] = [];
  for (let elapsed = 0; elapsed < GAZE_DURATION_MS; elapsed += SAMPLE_MS) {
    if (inGap(elapsed)) continue;
    const segment = Math.floor(elapsed / 2300);
    const right = wide && segment % 2 === 1;
    samples.push({
      elapsed,
      x: (right ? 585 : 95) + (segment % 3) * 75 + 95 * next(),
      y: 78 + (segment % 4) * 96 + 68 * next(),
    });
  }
  return samples;
}

function gazeStream(id: string, label: string, wide: boolean): GazeStream {
  return {
    id,
    label,
    samples: gazeSamples(wide),
    gaps: GAZE_LAB_TRACKING_GAPS.map((gap) => ({ ...gap })),
  };
}

export const EXAMPLE_CALIBRATION_REPORT: CalibrationQualityReport = {
  pointCount: 9,
  leftRightAgreement: 0.94,
  gridAgreement: 0.91,
  averageErrorPx: 16.5,
};

export const GAZE_LAB_CLICK_SEQUENCE: readonly ResponseEvent[] = [
  ...targetTrial("demo-balanced", 10, 10).events,
];

export const GAZE_LAB_STREAMS: readonly [GazeStream, GazeStream] = [
  gazeStream("demo-gaze-left-biased", "Left-biased scan", false),
  gazeStream("demo-gaze-wide", "Both-halves scan", true),
];

export const GAZE_LAB_FIXTURE = {
  clicks: GAZE_LAB_CLICK_SEQUENCE,
  streams: GAZE_LAB_STREAMS,
  calibration: EXAMPLE_CALIBRATION_REPORT,
} as const;
