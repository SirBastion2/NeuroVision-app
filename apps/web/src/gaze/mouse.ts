import type { GazeQuality, GazeSample, SmoothingLevel } from "../metrics/types";
import { Emitter, TRIVIAL_CALIBRATION, type GazeSource, type TrackerStatus } from "./types";

/**
 * The mouse cursor stands in for gaze (development, demos, and participants without a
 * camera). Samples at display rate while the pointer is over the page.
 */
export class MouseGazeSource implements GazeSource {
  readonly kind = "mouse" as const;
  private samples = new Emitter<GazeSample>();
  private status = new Emitter<TrackerStatus>();
  private pos: { x: number; y: number } | null = null;
  private raf = 0;
  private smoothing: SmoothingLevel = "medium";
  private onMove = (e: PointerEvent) => {
    this.pos = { x: e.clientX, y: e.clientY };
  };
  private onLeave = () => {
    this.pos = null;
  };

  async init() {}
  async calibrate() {
    return TRIVIAL_CALIBRATION;
  }
  async validate() {
    return null;
  }
  start() {
    if (this.raf) return;
    window.addEventListener("pointermove", this.onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", this.onLeave);
    const tick = () => {
      const p = this.pos;
      this.samples.emit({
        t: performance.now(),
        x: p ? p.x : null,
        y: p ? p.y : null,
        confidence: p ? 1 : 0,
        blink: false,
        isFixation: false,
        headYawDeg: null,
        headPitchDeg: null,
      });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.status.emit({ faceVisible: true, movedTooMuch: false, fps: null });
  }
  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener("pointermove", this.onMove);
    document.documentElement.removeEventListener("pointerleave", this.onLeave);
  }
  subscribe(cb: (s: GazeSample) => void) {
    return this.samples.on(cb);
  }
  subscribeStatus(cb: (s: TrackerStatus) => void) {
    return this.status.on(cb);
  }
  setSmoothing(level: SmoothingLevel) {
    this.smoothing = level;
  }
  getQuality(): GazeQuality {
    return {
      source: "mouse",
      calibrated: true,
      smoothing: this.smoothing,
      validation: null,
      calibrationHeadYawDeg: null,
      trackedFraction: null,
      fps: null,
      clickRefinement: null,
    };
  }
}
