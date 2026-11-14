import { DEFAULT_QUALITY_POLICY } from "./contracts.js";
import {
  integrateGazeRegions,
  type RegionDefinition,
} from "./integrate.js";
import { provenanceFor } from "./labels.js";
import type { GazeSample as ContractGazeSample } from "./contracts.js";

/**
 * SIMULATED LAB model — deterministic 100 ms cadence for demos only.
 * Not webcam gaze. Do not reuse SAMPLE_MS summarizer for real irregular samples;
 * use `integrateGazeRegions` / `summarizeGaze` instead.
 */
export const SAMPLE_MS = 100;

/** Legacy lab sample shape used by gaze lab replay UI (matches domain GazeSample). */
export type LabGazeSample = { elapsed: number; x: number; y: number };
export type LabGazeGap = { start: number; end: number };
export type LabGazeTrace = { samples: LabGazeSample[]; gaps: LabGazeGap[] };

export const SIMULATED_LAB_PROVENANCE = provenanceFor("simulated-lab");

function random(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}

export function simulatedTrace(wide: boolean, duration: number): LabGazeTrace {
  const rng = random(wide ? 802 : 801);
  const gaps = [
    { start: 6800, end: 9000 },
    { start: 15500, end: 16900 },
  ];
  const samples: LabGazeSample[] = [];
  for (let elapsed = 0; elapsed < duration; elapsed += SAMPLE_MS) {
    if (gaps.some((gap) => elapsed >= gap.start && elapsed < gap.end)) continue;
    const segment = Math.floor(elapsed / 2300);
    const right = wide && segment % 2 === 1;
    samples.push({
      elapsed,
      x: (right ? 585 : 95) + (segment % 3) * 75 + 95 * rng(),
      y: 78 + (segment % 4) * 96 + 68 * rng(),
    });
  }
  return { samples, gaps };
}

/**
 * Fixed-cadence summarizer for simulated lab traces only.
 * Gaps contribute no gaze time (tracking loss is not dwell).
 */
export function gazeSummary(trace: LabGazeTrace, time: number) {
  const bins = Array<number>(6).fill(0);
  let tracked = 0;
  for (const sample of trace.samples) {
    const weight = Math.min(SAMPLE_MS, time - sample.elapsed);
    if (weight <= 0) continue;
    bins[Math.min(5, Math.floor(sample.x / 160))] += weight;
    tracked += weight;
  }
  return { bins, tracked, left: bins[0]! + bins[1]! + bins[2]! };
}

/** Convert legacy lab samples into contract samples for irregular-cadence analysis. */
export function toContractSamples(
  trialId: string,
  trace: LabGazeTrace,
): ContractGazeSample[] {
  return trace.samples.map((s, seq) => ({
    trialId,
    seq,
    captureMs: s.elapsed,
    inferenceDoneMs: s.elapsed,
    timestampBasis: "estimated" as const,
    x: s.x,
    y: s.y,
    providerQuality: 1,
    valid: true,
  }));
}

export const BOARD_HALF_REGIONS: RegionDefinition[] = [
  { id: "left", x: 0, y: 0, width: 480, height: 540 },
  { id: "right", x: 480, y: 0, width: 480, height: 540 },
];

/**
 * Optional bridge: analyze a simulated lab slice with the real irregular
 * integrator (still labeled simulated — never observed webcam).
 */
export function analyzeSimulatedLabSlice(
  trialId: string,
  trace: LabGazeTrace,
  trialDurationMs: number,
) {
  return integrateGazeRegions({
    samples: toContractSamples(trialId, trace),
    regions: BOARD_HALF_REGIONS,
    trialDurationMs,
    maxIntegrationGapMs: DEFAULT_QUALITY_POLICY.maxIntegrationGapMs,
  });
}
