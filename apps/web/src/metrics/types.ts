/**
 * Shared types for the screening module (gaze, tests, metrics).
 *
 * Coordinate system: every x/y in a SessionResult (layout items, taps, gaze) is in
 * CSS pixels of the test area, origin top-left. The test area is the full viewport
 * while a test runs, and its size is recorded in `layout.area`. Normalized x maps the
 * area to [-1, 1] (left edge -1, right edge +1); all neglect metrics use x only.
 *
 * Screening and monitoring only. Nothing here is clinically validated.
 */

export const SESSION_SCHEMA = "neurovision.screening.session/1" as const;

/** One gaze estimate. x/y are null when no usable gaze (no face, blink, warm-up). */
export interface GazeSample {
  /** ms since the start of the test (or of the recording). */
  t: number;
  x: number | null;
  y: number | null;
  /** 0 = no estimate, 1 = good. Mouse and synthetic sources report 1. */
  confidence: number;
  blink: boolean;
  isFixation: boolean;
  /** Positive = head turned toward screen left. Null when unknown. */
  headYawDeg: number | null;
  /** Positive = head tilted up. Null when unknown. */
  headPitchDeg: number | null;
}

export type TapKind = "cancel" | "revisit" | "commission";

export interface TapEvent {
  /** ms since the start of the test. */
  t: number;
  x: number;
  y: number;
  /** Item (star test) or line (bisection) the tap resolved to; null for empty space. */
  targetId: string | null;
  kind: TapKind;
}

export type TestKind = "star-cancellation" | "line-bisection";
export type GazeSourceKind = "webcam" | "mouse" | "synthetic";

export interface Area {
  width: number;
  height: number;
}

export type StarItemKind = "target" | "big-star" | "letter" | "triangle";

export interface StarItem {
  id: string;
  kind: StarItemKind;
  x: number;
  y: number;
  /** Visual radius in px. */
  size: number;
  rotation: number;
  letter?: string;
}

export interface StarLayout {
  kind: "star-cancellation";
  seed: number;
  area: Area;
  items: StarItem[];
  /** Tap radius used to resolve taps to items; scales with grid spacing. */
  hitRadius: number;
  /** Grid spacing, used for adaptive "looked at" radii. */
  spacing: { x: number; y: number };
}

export interface BisectionLine {
  id: string;
  x1: number;
  x2: number;
  y: number;
}

export interface BisectionLayout {
  kind: "line-bisection";
  seed: number;
  area: Area;
  lines: BisectionLine[];
  /** Max vertical distance (px) for a tap to count as on a line. */
  tolerance: number;
}

export type TestLayout = StarLayout | BisectionLayout;

export interface Difficulty {
  level: number;
  /** Multiplier on the number of distractors (1 = standard). */
  distractorDensity: number;
  /** Multiplier on target size (1 = standard; smaller is harder). */
  targetScale: number;
  timeLimitMs: number;
}

export interface StarMetrics {
  kind: "star-cancellation";
  targets: number;
  hits: number;
  hitRate: number;
  hitRateLeft: number;
  hitRateRight: number;
  /** Hit rate in 6 equal horizontal bins, left to right. Null for an empty bin. */
  hitRateByBin: Array<number | null>;
  /** Center of Cancellation: mean x of found targets minus mean x of all targets (normalized). Positive = shifted right. */
  centerOfCancellation: number | null;
  /** True when CoC > 0.08. An unvalidated screening flag, not a diagnosis. */
  cocFlag: boolean;
  firstTap: { x: number; side: "left" | "right" } | null;
  pathCrossings: number;
  revisits: number;
  commissions: number;
  durationMs: number;
  timedOut: boolean;
}

export interface BisectionMetrics {
  kind: "line-bisection";
  lines: number;
  answered: number;
  /** Signed deviation per line, % of line length (positive = rightward). Null when unanswered. */
  deviations: Array<number | null>;
  meanDeviation: number | null;
  sdDeviation: number | null;
  meanDeviationLeftLines: number | null;
  meanDeviationRightLines: number | null;
  durationMs: number;
}

export interface GazeMetrics {
  /** Fraction of frames with a usable gaze estimate. */
  trackedFraction: number;
  /** Share of tracked gaze time on the left half. */
  leftGazeFraction: number | null;
  /** Mean normalized gaze x minus mean normalized x of all targets/lines. Positive = shifted right. */
  gazeCenterOfCancellation: number | null;
  /** Direction of the first gaze excursion out of the central band. */
  firstLookDirection: "left" | "right" | null;
  /** 5th percentile of normalized gaze x (how far left the gaze reached). */
  leftmostReach: number | null;
  /** Mean head yaw minus the calibration baseline, degrees. Positive = toward screen left. */
  meanHeadYawDeg: number | null;
  /** Missed targets the gaze dwelt on for >= 250 ms. Approximate (uses vertical gaze). */
  missedLookedAt: string[];
  /** Tracked gaze time per 6 horizontal bins, ms. */
  gazeMsByBin: number[];
}

export interface DeviationComponent {
  name: string;
  value: number;
  weight: number;
}

export interface DeviationScore {
  /** 0 = within the healthy range, 1 = outside it. Transparent weighted sum; not a diagnosis. */
  score: number;
  components: DeviationComponent[];
}

export interface SessionMetrics {
  test: StarMetrics | BisectionMetrics;
  gaze: GazeMetrics | null;
  deviation: DeviationScore;
}

export interface ValidationPoint {
  /** Target in page px at validation time. */
  target: { x: number; y: number };
  raw: { x: number; y: number } | null;
  corrected: { x: number; y: number } | null;
}

export interface ValidationReport {
  points: ValidationPoint[];
  leftRightAccuracy: number | null;
  cellAccuracy: number | null;
  meanErrorPx: number | null;
  /** Mean signed (predicted - true) x, px. Positive = reads rightward. */
  horizontalBiasPx: number | null;
  /** Same, for points in the left 20% of the screen. */
  leftEdgeBiasPx: number | null;
  correctionApplied: boolean;
  /** Leave-one-out mean error without and with the affine correction. */
  looErrorRawPx: number | null;
  looErrorCorrectedPx: number | null;
}

export interface GazeQuality {
  source: GazeSourceKind | "replay";
  calibrated: boolean;
  smoothing: SmoothingLevel;
  validation: ValidationReport | null;
  calibrationHeadYawDeg: number | null;
  /** Fraction of frames with a usable estimate over the recent window. */
  trackedFraction: number | null;
  fps: number | null;
  clickRefinement: ClickRefinement | null;
}

export type SmoothingLevel = "low" | "medium" | "high";

export interface AffineCorrection {
  ax: number;
  bx: number;
  ay: number;
  by: number;
}

export interface ClickRefinement {
  pairs: number;
  correction: AffineCorrection | null;
  looErrorRawPx: number | null;
  looErrorCorrectedPx: number | null;
  /** Whether the refined gaze is what `gaze` and `metrics.gaze` currently hold. */
  applied: boolean;
}

export interface SessionResult {
  schema: typeof SESSION_SCHEMA;
  id: string;
  test: TestKind;
  source: GazeSourceKind;
  label: string;
  /** ISO timestamp. */
  createdAt: string;
  screen: { width: number; height: number; dpr: number; screenWidth: number; screenHeight: number };
  layout: TestLayout;
  difficulty: Difficulty;
  cued: boolean;
  taps: TapEvent[];
  gaze: GazeSample[];
  metrics: SessionMetrics;
  quality: GazeQuality;
  /** Gaze before click refinement, kept so the toggle is reversible. */
  gazeUnrefined?: GazeSample[];
}

export function sessionToJson(session: SessionResult | SessionResult[]): string {
  return JSON.stringify(session, null, 2);
}
