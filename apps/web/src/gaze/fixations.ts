import type { GazeSample } from "../metrics/types";

/** I-DT parameters: dispersion (x range + y range) and minimum duration. */
export const FIXATION_DISPERSION_PX = 70;
export const FIXATION_MIN_MS = 100;
/** A gap longer than this ends a fixation. */
const MAX_GAP_MS = 120;

const usable = (s: GazeSample) => s.x !== null && s.y !== null && !s.blink;

function dispersion(samples: readonly GazeSample[], from: number, to: number): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = from; i <= to; i++) {
    const s = samples[i]!;
    if (s.x! < minX) minX = s.x!;
    if (s.x! > maxX) maxX = s.x!;
    if (s.y! < minY) minY = s.y!;
    if (s.y! > maxY) maxY = s.y!;
  }
  return maxX - minX + (maxY - minY);
}

/**
 * Dispersion-threshold identification (I-DT) over a recorded sequence. Returns a copy
 * with `isFixation` set; untracked samples are never fixations.
 */
export function markFixations(
  samples: readonly GazeSample[],
  maxDispersion = FIXATION_DISPERSION_PX,
  minDuration = FIXATION_MIN_MS,
): GazeSample[] {
  const out = samples.map((s) => ({ ...s, isFixation: false }));
  // Split into contiguous tracked runs.
  const runs: number[][] = [];
  let run: number[] = [];
  out.forEach((s, i) => {
    const prev = run.length ? out[run[run.length - 1]!]! : null;
    if (!usable(s) || (prev && s.t - prev.t > MAX_GAP_MS)) {
      if (run.length) runs.push(run);
      run = usable(s) ? [i] : [];
    } else run.push(i);
  });
  if (run.length) runs.push(run);

  for (const idx of runs) {
    const seq = idx.map((i) => out[i]!);
    let start = 0;
    while (start < seq.length) {
      let end = start;
      while (end < seq.length && seq[end]!.t - seq[start]!.t < minDuration) end++;
      if (end >= seq.length) break;
      if (dispersion(seq, start, end) <= maxDispersion) {
        while (end + 1 < seq.length && dispersion(seq, start, end + 1) <= maxDispersion) end++;
        for (let k = start; k <= end; k++) seq[k]!.isFixation = true;
        start = end + 1;
      } else start++;
    }
  }
  return out;
}

/**
 * Online variant for live display: a sample is a fixation when the trailing window of
 * at least `minDuration` ms stays within the dispersion threshold.
 */
export class LiveFixationDetector {
  private buf: GazeSample[] = [];
  constructor(
    private maxDispersion = FIXATION_DISPERSION_PX,
    private minDuration = FIXATION_MIN_MS,
  ) {}
  push(s: GazeSample): boolean {
    if (!usable(s)) {
      this.buf = [];
      return false;
    }
    this.buf.push(s);
    while (this.buf.length > 2 && s.t - this.buf[1]!.t >= this.minDuration) this.buf.shift();
    if (s.t - this.buf[0]!.t < this.minDuration) return false;
    return dispersion(this.buf, 0, this.buf.length - 1) <= this.maxDispersion;
  }
}
