import type { BoardDensity, LineSegment, TaskKind, TaskLayout } from "./layouts.js";
import type { ResponseEvent } from "./events.js";
import type { CalibrationQualityReport } from "./gaze.js";

export type PracticeCue = "left" | "right" | "none";

export type SessionSource = "live" | "demonstration";
export type SessionStatus = "complete" | "incomplete";
export type InputModality = "mouse-trackpad" | "keyboard" | "touch";
export type TrialEndReason = "done" | "timeout" | "stop" | "resize" | "hidden" | "skip";
export type ViewportClass = "desktop-960" | "unsupported";

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
  class: ViewportClass;
}

export interface TrialRecord {
  id: string;
  task: TaskKind;
  layout: TaskLayout;
  line?: LineSegment;
  events: ResponseEvent[];
  duration: number;
  end: TrialEndReason;
  input: InputModality;
  viewport: Viewport;
}

export interface PracticeSuggestion {
  version: string;
  cue: PracticeCue;
  density: BoardDensity;
  level: 0 | 1 | 2;
  explanation: string;
  metrics: { hitRate: number; asymmetry: number } | null;
  override: string | null;
  scanGuide?: boolean;
}

export interface PracticeRound {
  trial: TrialRecord;
  config: PracticeSuggestion;
  /** True when this round was requested as transfer-cue isolation. Absent/false is ordinary practice. */
  transfer?: boolean;
}

export interface SessionRecord {
  id: string;
  profileId: string;
  alias: string;
  source: SessionSource;
  protocol: string;
  scorer: string;
  taskIds: TaskKind[];
  status: SessionStatus;
  input: InputModality;
  viewport: Viewport;
  startedAt: string;
  completedAt: string;
  trials: TrialRecord[];
  practice: PracticeRound[];
  decision: PracticeSuggestion;
  pointerSampling: boolean;
  calibration: CalibrationQualityReport | null;
}

export const SESSION_SOURCES: readonly SessionSource[] = ["live", "demonstration"];
export const SESSION_STATUSES: readonly SessionStatus[] = ["complete", "incomplete"];
export const INPUT_MODALITIES: readonly InputModality[] = ["mouse-trackpad", "keyboard", "touch"];
export const TRIAL_END_REASONS: readonly TrialEndReason[] = [
  "done",
  "timeout",
  "stop",
  "resize",
  "hidden",
  "skip",
];
export const VIEWPORT_CLASSES: readonly ViewportClass[] = ["desktop-960", "unsupported"];

export function sessionSourceLabel(source: SessionSource): string {
  return source === "live" ? "Live session" : "Demonstration";
}

export function isScoredTrialEnd(end: TrialEndReason): boolean {
  return end === "done" || end === "timeout";
}
