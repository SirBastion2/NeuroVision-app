import type { TimestampBasis, TrialClock } from "./contracts.js";

export class MonotonicTrialClock implements TrialClock {
  private readonly originMs: number;
  private readonly nowFn: () => number;

  constructor(nowFn: () => number = () => performance.now()) {
    this.nowFn = nowFn;
    this.originMs = nowFn();
  }

  now(): number {
    return Math.max(0, this.nowFn() - this.originMs);
  }
}

export interface CaptureTiming {
  captureMs: number;
  inferenceDoneMs: number;
  timestampBasis: TimestampBasis;
}

/**
 * Map provider timing into the trial clock.
 * Never fabricate capture precision by subtracting an assumed constant delay.
 */
export function mapProviderTiming(input: {
  clock: TrialClock;
  frameCaptureMs?: number;
  callbackMs?: number;
}): CaptureTiming {
  const inferenceDoneMs = input.clock.now();

  if (
    typeof input.frameCaptureMs === "number" &&
    Number.isFinite(input.frameCaptureMs)
  ) {
    return {
      captureMs: Math.max(0, input.frameCaptureMs),
      inferenceDoneMs: Math.max(input.frameCaptureMs, inferenceDoneMs),
      timestampBasis: "frame",
    };
  }

  const captureMs =
    typeof input.callbackMs === "number" && Number.isFinite(input.callbackMs)
      ? Math.max(0, input.callbackMs)
      : inferenceDoneMs;

  return {
    captureMs,
    inferenceDoneMs: Math.max(captureMs, inferenceDoneMs),
    timestampBasis: "estimated",
  };
}
