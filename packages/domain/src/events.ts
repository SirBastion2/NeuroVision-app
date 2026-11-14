import { TARGET_HIT_RADIUS, LINE_Y_TOLERANCE, type Point } from "./board.js";
import { isOnLineSegment, type LineSegment, type TaskKind, type TaskLayout } from "./layouts.js";

export type ResponseEventType =
  | "target"
  | "repeat"
  | "distractor"
  | "background"
  | "bisection"
  | "out-of-band"
  | "pointer";

export interface ResponseEvent {
  sessionId: string;
  trialId: string;
  seq: number;
  elapsed: number;
  x: number;
  y: number;
  stimulusId: string | null;
  type: ResponseEventType;
}

export const RESPONSE_EVENT_TYPES: readonly ResponseEventType[] = [
  "target",
  "repeat",
  "distractor",
  "background",
  "bisection",
  "out-of-band",
  "pointer",
];

export function sortEvents(events: readonly ResponseEvent[]): ResponseEvent[] {
  return [...events].sort((a, b) => a.elapsed - b.elapsed || a.seq - b.seq);
}

function nearestStimulus(layout: TaskLayout, point: Point) {
  let match: (typeof layout.stimuli)[number] | undefined;
  for (const stimulus of layout.stimuli) {
    const distance = Math.hypot(stimulus.x - point.x, stimulus.y - point.y);
    if (distance <= TARGET_HIT_RADIUS && (!match || distance < Math.hypot(match.x - point.x, match.y - point.y))) {
      match = stimulus;
    }
  }
  return match;
}

export interface ClassifyResponseInput {
  sessionId: string;
  trialId: string;
  task: TaskKind;
  layout: TaskLayout;
  line?: LineSegment;
  existing: readonly ResponseEvent[];
  point: Point;
  elapsed: number;
  pointer?: boolean;
}

export function classifyResponse(input: ClassifyResponseInput): ResponseEvent {
  const elapsed = Math.max(0, input.elapsed);
  const seq = input.existing.length + 1;
  const base = {
    sessionId: input.sessionId,
    trialId: input.trialId,
    seq,
    elapsed,
    x: input.point.x,
    y: input.point.y,
  };

  if (input.pointer) {
    return { ...base, stimulusId: null, type: "pointer" };
  }

  if (input.task === "line-bisection" && input.line) {
    const onLine = isOnLineSegment(input.point, input.line, LINE_Y_TOLERANCE);
    return { ...base, stimulusId: null, type: onLine ? "bisection" : "out-of-band" };
  }

  const stimulus = nearestStimulus(input.layout, input.point);
  if (!stimulus) {
    return { ...base, stimulusId: null, type: "background" };
  }
  if (stimulus.kind === "distractor") {
    return { ...base, stimulusId: stimulus.id, type: "distractor" };
  }
  const alreadySelected = input.existing.some(
    (event) => event.stimulusId === stimulus.id && event.type !== "pointer",
  );
  return {
    ...base,
    stimulusId: stimulus.id,
    type: alreadySelected ? "repeat" : "target",
  };
}
