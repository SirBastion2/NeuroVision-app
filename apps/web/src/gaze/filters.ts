import type { SmoothingLevel } from "../metrics/types";

/** Running median of the last 3 values. Removes single-frame spikes before smoothing. */
export class Median3 {
  private buf: number[] = [];
  push(v: number): number {
    this.buf.push(v);
    if (this.buf.length > 3) this.buf.shift();
    const s = [...this.buf].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }
  reset() {
    this.buf = [];
  }
}

/**
 * One Euro filter (Casiez et al. 2012): adaptive low-pass that smooths jitter when the
 * gaze is still and lets saccades through quickly. Time in ms; cutoffs in Hz.
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t: number | null = null;
  constructor(
    public minCutoff: number,
    public beta: number,
    public dCutoff = 1,
  ) {}
  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value: number, tMs: number): number {
    if (this.x === null || this.t === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
  reset() {
    this.x = null;
    this.t = null;
    this.dx = 0;
  }
}

export const SMOOTHING_PRESETS: Record<SmoothingLevel, { minCutoff: number; beta: number }> = {
  low: { minCutoff: 2.2, beta: 0.012 },
  medium: { minCutoff: 1.0, beta: 0.006 },
  high: { minCutoff: 0.45, beta: 0.003 },
};

/** Median-of-3 then One Euro, per axis. */
export class GazeSmoother {
  private mx = new Median3();
  private my = new Median3();
  private fx: OneEuro;
  private fy: OneEuro;
  constructor(level: SmoothingLevel = "medium") {
    const p = SMOOTHING_PRESETS[level];
    this.fx = new OneEuro(p.minCutoff, p.beta);
    this.fy = new OneEuro(p.minCutoff, p.beta);
  }
  setLevel(level: SmoothingLevel) {
    const p = SMOOTHING_PRESETS[level];
    for (const f of [this.fx, this.fy]) {
      f.minCutoff = p.minCutoff;
      f.beta = p.beta;
    }
  }
  push(x: number, y: number, tMs: number): { x: number; y: number } {
    return { x: this.fx.filter(this.mx.push(x), tMs), y: this.fy.filter(this.my.push(y), tMs) };
  }
  reset() {
    this.mx.reset();
    this.my.reset();
    this.fx.reset();
    this.fy.reset();
  }
}

/** Blink detector: openness below 0.65 of its rolling median (over ~2 s of open-eye frames). */
export class BlinkDetector {
  private history: number[] = [];
  constructor(
    private ratio = 0.65,
    private window = 60,
  ) {}
  isBlink(openness: number): boolean {
    const sorted = [...this.history].sort((a, b) => a - b);
    const med = sorted.length >= 10 ? sorted[Math.floor(sorted.length / 2)]! : null;
    const blink = med !== null && openness < this.ratio * med;
    if (!blink) {
      this.history.push(openness);
      if (this.history.length > this.window) this.history.shift();
    }
    return blink;
  }
}
