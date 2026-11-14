import {
  LINE_BISECTION_TRIAL_COUNT,
  PROTOCOL_ID,
  SCORER_ID,
  createLineBisectionLayout,
  createTargetSelectionLayout,
  scoreSession,
  suggestPractice,
  type InputModality,
  type LayoutVariant,
  type SessionRecord,
  type SessionSource,
  type TrialEndReason,
  type TrialRecord,
  type Viewport,
} from "@neurovision/domain";

/** Time limits per trial. UI policy owned by D+E; not part of the scoring contract. */
export const TIME_LIMIT_MS = {
  "target-selection": 60_000,
  "line-bisection": 15_000,
} as const;

export function profileIdFor(alias: string): string {
  const slug = alias
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "anonymous";
}

/** Participant ID from sign-in; empty when nobody is signed in. */
export function sessionAliasForParticipant(participantId: string | null | undefined): string {
  return participantId?.trim() ?? "";
}

export interface NewSessionOptions {
  alias: string;
  input?: InputModality;
  viewport: Viewport;
  source?: SessionSource;
  now?: Date;
  id?: string;
}

export function createSession(options: NewSessionOptions): SessionRecord {
  const now = options.now ?? new Date();
  const id = options.id ?? `s-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    profileId: profileIdFor(options.alias),
    alias: options.alias.trim() || "Anonymous",
    source: options.source ?? "live",
    protocol: PROTOCOL_ID,
    scorer: SCORER_ID,
    taskIds: ["target-selection", "line-bisection"],
    status: "incomplete",
    input: options.input ?? "mouse-trackpad",
    viewport: options.viewport,
    startedAt: now.toISOString(),
    // The contract requires a timestamp; it is replaced when the session ends.
    completedAt: now.toISOString(),
    trials: [],
    practice: [],
    decision: suggestPractice(null),
    pointerSampling: false,
    calibration: null,
  };
}

function blankTrial(session: SessionRecord, id: string, viewport: Viewport): Omit<TrialRecord, "task" | "layout"> {
  return { id, events: [], duration: 0, end: "stop", input: session.input, viewport };
}

export function newTargetSelectionTrial(session: SessionRecord, variant: LayoutVariant, viewport: Viewport): TrialRecord {
  return {
    ...blankTrial(session, `${session.id}-ts`, viewport),
    task: "target-selection",
    layout: createTargetSelectionLayout(variant),
  };
}

export function newLineTrial(session: SessionRecord, index: number, viewport: Viewport): TrialRecord {
  const { layout, line } = createLineBisectionLayout(index);
  return { ...blankTrial(session, `${session.id}-lb-${index}`, viewport), task: "line-bisection", layout, line };
}

export function isInterruption(end: TrialEndReason): boolean {
  return end === "stop" || end === "resize" || end === "hidden";
}

export interface RecordResult {
  session: SessionRecord;
  finished: boolean;
}

/**
 * Appends an assessment trial. The session ends after the last line or on any
 * interruption; an interrupted session stays incomplete and is excluded from trends.
 */
export function recordAssessmentTrial(session: SessionRecord, trial: TrialRecord, now = new Date()): RecordResult {
  const trials = [...session.trials, trial];
  const lines = trials.filter((t) => t.task === "line-bisection").length;
  const interrupted = isInterruption(trial.end);
  const finished = interrupted || lines >= LINE_BISECTION_TRIAL_COUNT;
  if (!finished) return { session: { ...session, trials }, finished };
  const ended: SessionRecord = {
    ...session,
    trials,
    status: interrupted ? "incomplete" : "complete",
    completedAt: now.toISOString(),
  };
  return { session: { ...ended, decision: scoreSession(ended).practice }, finished };
}
