import type { GazeQuality, GazeSample, SmoothingLevel, ValidationReport } from "../metrics/types";

/** What the calibration / validation UI must provide. The tracker drives it. */
export interface CalibrationPresenter {
  /** Animate the dot to a page point (beep on arrival). Resolves when it has arrived. */
  moveTo(point: { x: number; y: number }, opts?: { beep?: boolean; instruction?: string }): Promise<void>;
  /** Wait for a click on the dot (or dwell when autoAdvanceMs is set). False = cancelled (Esc). */
  waitForConfirm(opts: { autoAdvanceMs: number | null; instruction?: string }): Promise<boolean>;
  /** Keep the dot still for `ms` with a progress ring. False = cancelled. */
  hold(ms: number, opts?: { kind?: "sample" | "head" | "settle" | "validate"; instruction?: string }): Promise<boolean>;
}

export interface CalibrationOptions {
  presenter: CalibrationPresenter;
  /** Dwell instead of click (for participants with a weak arm). */
  autoAdvance?: boolean;
}

export interface CalibrationResult {
  ok: boolean;
  cancelled: boolean;
  points: number;
  frames: number;
  lambda: { x: number; y: number } | null;
  cvErrorPx: { x: number; y: number } | null;
  message?: string;
}

export interface TrackerStatus {
  /** False after ~300 ms without a detected face. */
  faceVisible: boolean;
  /** True after head-position features stay outside the calibration range for > 600 ms. */
  movedTooMuch: boolean;
  fps: number | null;
}

/**
 * Common interface for every gaze source (webcam, mouse, synthetic, replay), so tests
 * and teammates' code don't care where gaze comes from. Samples carry `t` in
 * performance.now() ms and page coordinates.
 */
export interface GazeSource {
  readonly kind: "webcam" | "mouse" | "synthetic" | "replay";
  init(): Promise<void>;
  calibrate(opts?: CalibrationOptions): Promise<CalibrationResult>;
  validate(opts?: { presenter: CalibrationPresenter }): Promise<ValidationReport | null>;
  start(): void;
  /** Stops emitting. The webcam tracker also releases the camera (the light goes off). */
  stop(): void;
  subscribe(cb: (s: GazeSample) => void): () => void;
  getQuality(): GazeQuality;
  subscribeStatus(cb: (s: TrackerStatus) => void): () => void;
  setSmoothing(level: SmoothingLevel): void;
}

/** Shared listener plumbing for the simple sources. */
export class Emitter<T> {
  private set = new Set<(v: T) => void>();
  on(cb: (v: T) => void) {
    this.set.add(cb);
    return () => void this.set.delete(cb);
  }
  emit(v: T) {
    this.set.forEach((cb) => cb(v));
  }
}

export const TRIVIAL_CALIBRATION: CalibrationResult = { ok: true, cancelled: false, points: 0, frames: 0, lambda: null, cvErrorPx: null };
