import type { GazeGap, GazeSample } from "./contracts.js";

/** Gaps never become dwell — recorded and excluded from integration. */
export function detectGaps(
  samples: readonly GazeSample[],
  trialDurationMs: number,
  maxIntegrationGapMs: number,
): GazeGap[] {
  const gaps: GazeGap[] = [];
  if (samples.length === 0) {
    if (trialDurationMs > 0) {
      gaps.push({ startMs: 0, endMs: trialDurationMs, reason: "no_samples" });
    }
    return gaps;
  }

  const ordered = [...samples].sort(
    (a, b) => a.captureMs - b.captureMs || a.seq - b.seq,
  );

  if (ordered[0]!.captureMs > 0) {
    gaps.push({
      startMs: 0,
      endMs: ordered[0]!.captureMs,
      reason: "leading_untracked",
    });
  }

  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i]!;
    if (!s.valid || s.x === null || s.y === null) {
      const prev = i > 0 ? ordered[i - 1]! : null;
      const start =
        prev && prev.valid && prev.x !== null && prev.y !== null
          ? prev.captureMs
          : s.captureMs;
      let end = s.captureMs;
      let j = i;
      while (
        j + 1 < ordered.length &&
        (!ordered[j + 1]!.valid ||
          ordered[j + 1]!.x === null ||
          ordered[j + 1]!.y === null)
      ) {
        j++;
        end = ordered[j]!.captureMs;
      }
      const nextValid = ordered
        .slice(j + 1)
        .find((x) => x.valid && x.x !== null && x.y !== null);
      end = nextValid ? nextValid.captureMs : Math.max(end, trialDurationMs);
      gaps.push({ startMs: start, endMs: end, reason: "invalid_samples" });
      i = j;
      continue;
    }

    if (i + 1 < ordered.length) {
      const next = ordered[i + 1]!;
      if (next.valid && next.x !== null && next.y !== null) {
        const dt = next.captureMs - s.captureMs;
        if (dt > maxIntegrationGapMs) {
          gaps.push({
            startMs: s.captureMs,
            endMs: next.captureMs,
            reason: "max_gap_exceeded",
          });
        }
      }
    }
  }

  const last = ordered[ordered.length - 1]!;
  if (last.captureMs < trialDurationMs) {
    gaps.push({
      startMs: last.captureMs,
      endMs: trialDurationMs,
      reason: "trailing_untracked",
    });
  }

  return mergeOverlappingGaps(gaps);
}

function mergeOverlappingGaps(gaps: GazeGap[]): GazeGap[] {
  if (gaps.length === 0) return [];
  const sorted = [...gaps].sort((a, b) => a.startMs - b.startMs);
  const out: GazeGap[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i]!;
    const cur = out[out.length - 1]!;
    if (g.startMs < cur.endMs) {
      cur.endMs = Math.max(cur.endMs, g.endMs);
      if (cur.reason !== g.reason) cur.reason = "merged";
    } else {
      out.push({ ...g });
    }
  }
  return out;
}
