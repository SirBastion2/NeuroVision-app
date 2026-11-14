import type { GazeQuality, GazeSample, SmoothingLevel } from "../metrics/types";
import { Emitter, TRIVIAL_CALIBRATION, type GazeSource, type TrackerStatus } from "./types";

export const RECORDING_SCHEMA = "neurovision.gaze.recording/1" as const;

/** A gaze recording: coordinates only, never video. `t` is ms from the first sample. */
export interface GazeRecording {
  schema: typeof RECORDING_SCHEMA;
  createdAt: string;
  viewport: { width: number; height: number };
  quality: GazeQuality | null;
  samples: GazeSample[];
}

/** Records everything a source emits until `stop()` is called. */
export function recordGaze(source: GazeSource): { stop: () => GazeRecording } {
  const samples: GazeSample[] = [];
  let t0: number | null = null;
  const off = source.subscribe((s) => {
    t0 ??= s.t;
    samples.push({ ...s, t: s.t - t0 });
  });
  return {
    stop() {
      off();
      return {
        schema: RECORDING_SCHEMA,
        createdAt: new Date().toISOString(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        quality: source.getQuality(),
        samples,
      };
    },
  };
}

export function parseRecording(json: string): GazeRecording {
  const r = JSON.parse(json) as Partial<GazeRecording>;
  if (r.schema !== RECORDING_SCHEMA || !Array.isArray(r.samples) || !r.viewport) {
    throw new Error("Not a NeuroVision gaze recording.");
  }
  return r as GazeRecording;
}

/**
 * Replays a recording in real time with the original timing (demo backup when the
 * camera or lighting fails). Coordinates are rescaled to the current viewport.
 */
export class ReplayGazeSource implements GazeSource {
  readonly kind = "replay" as const;
  private samples = new Emitter<GazeSample>();
  private status = new Emitter<TrackerStatus>();
  private raf = 0;
  private smoothing: SmoothingLevel = "medium";

  constructor(
    private recording: GazeRecording,
    private loop = true,
  ) {}

  async init() {}
  async calibrate() {
    return TRIVIAL_CALIBRATION;
  }
  async validate() {
    return this.recording.quality?.validation ?? null;
  }
  start() {
    if (this.raf || this.recording.samples.length === 0) return;
    const { samples, viewport } = this.recording;
    const duration = samples[samples.length - 1]!.t + 33;
    const start = performance.now();
    let i = 0;
    let lap = 0;
    const tick = () => {
      const now = performance.now();
      const sx = window.innerWidth / viewport.width;
      const sy = window.innerHeight / viewport.height;
      while (true) {
        const s = samples[i]!;
        const due = start + lap * duration + s.t;
        if (due > now) break;
        this.samples.emit({ ...s, t: due, x: s.x === null ? null : s.x * sx, y: s.y === null ? null : s.y * sy });
        i++;
        if (i >= samples.length) {
          if (!this.loop) return this.stop();
          i = 0;
          lap++;
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.status.emit({ faceVisible: true, movedTooMuch: false, fps: null });
  }
  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
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
    return { ...(this.recording.quality ?? ({} as GazeQuality)), source: "replay", smoothing: this.smoothing, calibrated: true } as GazeQuality;
  }
}
