import type { GazeQuality, GazeSample, SmoothingLevel } from "../metrics/types";
import { clamp, gauss, rng } from "../metrics/math";
import { Emitter, TRIVIAL_CALIBRATION, type GazeSource, type TrackerStatus } from "./types";

/**
 * Live synthetic gaze: fixations of 200–600 ms whose horizontal position is drawn from
 * a distribution that shifts right as the left-side lean rises, with jitter and occasional
 * blinks. Same interface as the webcam tracker, for demos without a camera.
 */
export class SyntheticGazeSource implements GazeSource {
  readonly kind = "synthetic" as const;
  private samples = new Emitter<GazeSample>();
  private status = new Emitter<TrackerStatus>();
  private timer = 0;
  private rand: () => number;
  private smoothing: SmoothingLevel = "medium";

  constructor(
    public lean = 0.6,
    seed = 1,
  ) {
    this.rand = rng(seed);
  }

  async init() {}
  async calibrate() {
    return TRIVIAL_CALIBRATION;
  }
  async validate() {
    return null;
  }
  start() {
    if (this.timer) return;
    let fix = { x: 0, y: 0, until: 0 };
    const tick = () => {
      const now = performance.now();
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (now >= fix.until) {
        const fx = clamp(0.5 + 0.32 * this.lean + gauss(this.rand) * (0.28 - 0.12 * this.lean), 0.02, 0.98);
        fix = { x: fx * W, y: (0.08 + 0.8 * this.rand()) * H, until: now + 200 + this.rand() * 400 };
      }
      const blink = this.rand() < 0.01;
      this.samples.emit({
        t: now,
        x: blink ? null : clamp(fix.x + gauss(this.rand) * 12, 0, W),
        y: blink ? null : clamp(fix.y + gauss(this.rand) * 18, 0, H),
        confidence: blink ? 0 : 0.9,
        blink,
        isFixation: false,
        headYawDeg: -12 * this.lean + gauss(this.rand),
        headPitchDeg: gauss(this.rand),
      });
    };
    this.timer = window.setInterval(tick, 33);
    this.status.emit({ faceVisible: true, movedTooMuch: false, fps: 30 });
  }
  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
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
      source: "synthetic",
      calibrated: true,
      smoothing: this.smoothing,
      validation: null,
      calibrationHeadYawDeg: 0,
      trackedFraction: null,
      fps: 30,
      clickRefinement: null,
    };
  }
}
