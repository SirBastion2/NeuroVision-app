import type { GazeGap, GazeSample } from "./contracts.js";
import { detectGaps } from "./gaps.js";

export interface RegionDefinition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IntegrationResult {
  regionMs: Record<string, number>;
  validObservedMs: number;
  coverageRatio: number;
  regionProportions: Record<string, number | null>;
  gaps: GazeGap[];
}

function regionContaining(
  x: number,
  y: number,
  regions: readonly RegionDefinition[],
): string | null {
  for (const r of regions) {
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
      return r.id;
    }
  }
  return null;
}

/**
 * Irregular-cadence integration. Do not extend the final sample to task end.
 * Gaps / invalid samples never become dwell.
 * SAMPLE_MS=100 summarizer remains only for deterministic simulated traces.
 */
export function integrateGazeRegions(input: {
  samples: readonly GazeSample[];
  regions: readonly RegionDefinition[];
  trialDurationMs: number;
  maxIntegrationGapMs: number;
}): IntegrationResult {
  const { samples, regions, trialDurationMs, maxIntegrationGapMs } = input;
  const gaps = detectGaps(samples, trialDurationMs, maxIntegrationGapMs);
  const regionMs: Record<string, number> = Object.fromEntries(
    regions.map((r) => [r.id, 0]),
  );
  regionMs.out_of_region = 0;

  const ordered = [...samples].sort(
    (a, b) => a.captureMs - b.captureMs || a.seq - b.seq,
  );
  let validObservedMs = 0;

  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i]!;
    const b = ordered[i + 1]!;
    if (!a.valid || a.x === null || a.y === null) continue;
    if (!b.valid || b.x === null || b.y === null) continue;
    const dt = b.captureMs - a.captureMs;
    if (dt <= 0 || dt > maxIntegrationGapMs) continue;
    if (a.captureMs >= trialDurationMs) continue;
    const end = Math.min(b.captureMs, trialDurationMs);
    const duration = end - a.captureMs;
    if (duration <= 0) continue;

    const rid = regionContaining(a.x, a.y, regions) ?? "out_of_region";
    regionMs[rid] = (regionMs[rid] ?? 0) + duration;
    validObservedMs += duration;
  }

  const coverageRatio =
    trialDurationMs > 0 ? validObservedMs / trialDurationMs : 0;
  const regionProportions: Record<string, number | null> = {};
  for (const [id, ms] of Object.entries(regionMs)) {
    regionProportions[id] = validObservedMs > 0 ? ms / validObservedMs : null;
  }

  return {
    regionMs,
    validObservedMs,
    coverageRatio,
    regionProportions,
    gaps,
  };
}
