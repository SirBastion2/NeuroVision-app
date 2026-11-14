import {
  classifyResponse,
  createLineBisectionLayout,
  createTargetSelectionLayout,
  lineLength,
  lineMidpoint,
  PROTOCOL_ID,
  SCORER_ID,
  scoreSession,
  type InputModality,
  type LayoutVariant,
  type ResponseEvent,
  type SessionRecord,
  type SessionSource,
  type SessionStatus,
  type TaskKind,
  type TaskLayout,
  type TrialEndReason,
  type TrialRecord,
  type Viewport,
} from "../src/index.ts";

export const VIEWPORT: Viewport = {
  width: 1280,
  height: 900,
  dpr: 1,
  class: "desktop-960",
};

export const INPUT: InputModality = "mouse-trackpad";

export function targetIds(side: "left" | "right", count: number, layout = createTargetSelectionLayout("fixed-a")): string[] {
  return layout.stimuli
    .filter((stimulus) => stimulus.kind === "target" && stimulus.side === side)
    .slice(0, count)
    .map((stimulus) => stimulus.id);
}

export function eventsForTargets(
  trial: TrialRecord,
  sessionId: string,
  ids: readonly string[],
  startElapsed = 800,
  step = 650,
): ResponseEvent[] {
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
        elapsed: startElapsed + index * step,
      }),
    );
  }
  return events;
}

export function makeTargetTrial(options: {
  sessionId: string;
  leftHits: number;
  rightHits: number;
  distractorHits?: number;
  repeatHits?: number;
  end?: TrialEndReason;
  variant?: LayoutVariant;
  layout?: TaskLayout;
}): TrialRecord {
  const layout = options.layout ?? createTargetSelectionLayout(options.variant ?? "fixed-a");
  const trial: TrialRecord = {
    id: `${options.sessionId}-target`,
    task: "target-selection",
    layout,
    events: [],
    duration: 22_000,
    end: options.end ?? "done",
    input: INPUT,
    viewport: VIEWPORT,
  };
  const ids = [
    ...targetIds("left", options.leftHits, layout),
    ...targetIds("right", options.rightHits, layout),
  ];
  const events = eventsForTargets(trial, options.sessionId, ids);

  const distractors = layout.stimuli.filter((stimulus) => stimulus.kind === "distractor");
  for (let index = 0; index < (options.distractorHits ?? 0); index += 1) {
    const stimulus = distractors[index % distractors.length];
    events.push(
      classifyResponse({
        sessionId: options.sessionId,
        trialId: trial.id,
        task: trial.task,
        layout,
        existing: events,
        point: { x: stimulus.x, y: stimulus.y },
        elapsed: 16_000 + index * 100,
      }),
    );
  }

  const firstTarget = events.find((event) => event.type === "target");
  for (let index = 0; index < (options.repeatHits ?? 0); index += 1) {
    if (!firstTarget) break;
    events.push(
      classifyResponse({
        sessionId: options.sessionId,
        trialId: trial.id,
        task: trial.task,
        layout,
        existing: events,
        point: { x: firstTarget.x, y: firstTarget.y },
        elapsed: 18_000 + index * 80,
      }),
    );
  }

  trial.events = events;
  return trial;
}

export function makeLineTrial(
  sessionId: string,
  index: number,
  offsetRatio: number | null,
  end: TrialEndReason = "done",
): TrialRecord {
  const { layout, line } = createLineBisectionLayout(index);
  const trial: TrialRecord = {
    id: `${sessionId}-line-${index}`,
    task: "line-bisection",
    layout,
    line,
    events: [],
    duration: 2000 + index * 200,
    end,
    input: INPUT,
    viewport: VIEWPORT,
  };
  if (offsetRatio !== null && end !== "skip") {
    const x = lineMidpoint(line) + lineLength(line) * offsetRatio;
    trial.events.push(
      classifyResponse({
        sessionId,
        trialId: trial.id,
        task: trial.task,
        layout,
        line,
        existing: trial.events,
        point: { x, y: line.y },
        elapsed: 1000 + index * 200,
      }),
    );
  }
  return trial;
}

export function makeSession(options: {
  id: string;
  alias: string;
  source?: SessionSource;
  status?: SessionStatus;
  leftHits: number;
  rightHits: number;
  distractorHits?: number;
  repeatHits?: number;
  targetEnd?: TrialEndReason;
  bisectionOffsets?: Array<number | null>;
  skipLastLine?: boolean;
  variant?: LayoutVariant;
  layout?: TaskLayout;
  protocol?: string;
  scorer?: string;
  completedAt?: string;
}): SessionRecord {
  const source = options.source ?? "live";
  const target = makeTargetTrial({
    sessionId: options.id,
    leftHits: options.leftHits,
    rightHits: options.rightHits,
    distractorHits: options.distractorHits,
    repeatHits: options.repeatHits,
    end: options.targetEnd ?? "done",
    variant: options.variant,
    layout: options.layout,
  });
  const offsets = options.bisectionOffsets ?? [0, 0, 0, 0, 0];
  const lines = offsets.map((offset, index) =>
    makeLineTrial(
      options.id,
      index,
      offset,
      options.skipLastLine && index === 4 ? "skip" : "done",
    ),
  );
  const session: SessionRecord = {
    id: options.id,
    profileId: "local",
    alias: options.alias,
    source,
    protocol: options.protocol ?? PROTOCOL_ID,
    scorer: options.scorer ?? SCORER_ID,
    taskIds: ["target-selection", "line-bisection"] as TaskKind[],
    status: options.status ?? "complete",
    input: INPUT,
    viewport: VIEWPORT,
    startedAt: "2026-11-14T14:00:00.000Z",
    completedAt: options.completedAt ?? "2026-11-14T14:02:00.000Z",
    trials: [target, ...lines],
    practice: [],
    decision: {
      version: "practice-v1",
      cue: "none",
      density: "standard",
      level: 0,
      explanation: "",
      metrics: null,
      override: null,
    },
    pointerSampling: false,
    calibration: null,
  };

  session.decision = scoreSession(session).practice;
  return session;
}
