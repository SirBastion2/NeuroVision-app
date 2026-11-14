import { LINE_Y_TOLERANCE, regionOfStimulus, type BoardRegion, type BoardSide } from "./board.js";
import { sortEvents } from "./events.js";
import { isOnLineSegment, lineLength, lineMidpoint } from "./layouts.js";
import { seProportionDiff, type TestObservation } from "./evidence.js";
import {
  BISECTION_SIGNED_ERROR_PCT,
  HOLLOW_RINGS_LATERAL_INDEX,
  compareToNorm,
  type HealthyRangeReading,
} from "./norms.js";
import { suggestPractice } from "./practice.js";
import { isScoredTrialEnd, type PracticeSuggestion, type SessionRecord, type TrialRecord } from "./session.js";

export interface SelectionCounts {
  hits: number;
  available: number;
  omissions: number;
  omissionRate: number | null;
  firstLatencyMs: number | null;
}

export interface OrderedHit {
  stimulusId: string;
  seq: number;
  elapsed: number;
  x: number;
  y: number;
  side: BoardSide;
  region: BoardRegion;
  order: number;
}

export interface TargetSelectionScore {
  valid: boolean;
  left: SelectionCounts;
  right: SelectionCounts;
  regions: Record<BoardRegion, SelectionCounts>;
  hits: number;
  available: number;
  omissions: number;
  hitRate: number;
  /** Left omission rate minus right, in percentage points. Practice heuristic only. */
  omissionAsymmetry: number | null;
  /** Eq. (1): right omission rate − left omission rate (0–1). Negative = left weaker. */
  lateralIndex: number | null;
  observation: TestObservation | null;
  firstLatencyMs: number | null;
  distractors: number;
  repeats: number;
  pathDistance: number;
  orderedHits: OrderedHit[];
}

export interface LineBisectionScore {
  valid: boolean;
  error: number | null;
  responseElapsedMs: number | null;
  outOfBand: number;
}

export interface LineBisectionSummary {
  errors: Array<number | null>;
  validCount: number;
  signedMedian: number | null;
  absoluteMedian: number | null;
  healthyRange: HealthyRangeReading | null;
}

export type SpatialPatternKind =
  | "balanced"
  | "left-omission"
  | "right-omission"
  | "low-selection"
  | "insufficient";

export interface SpatialPatternSummary {
  kind: SpatialPatternKind;
  description: string;
  hitRate: number;
  omissionAsymmetry: number | null;
  pathDistance: number;
  firstLatencyMs: number | null;
  distractors: number;
  repeats: number;
  laterality: HealthyRangeReading | null;
}

export interface ScoringResult {
  targetSelection: TargetSelectionScore | null;
  lineBisection: LineBisectionSummary;
  responseOrder: OrderedHit[];
  spatialPattern: SpatialPatternSummary;
  practice: PracticeSuggestion;
}

function emptyCounts(): SelectionCounts {
  return { hits: 0, available: 0, omissions: 0, omissionRate: null, firstLatencyMs: null };
}

function withRate(counts: Omit<SelectionCounts, "omissionRate" | "omissions"> & { omissions?: number }): SelectionCounts {
  const omissions = counts.omissions ?? counts.available - counts.hits;
  return {
    hits: counts.hits,
    available: counts.available,
    omissions,
    omissionRate: counts.available === 0 ? null : (100 * omissions) / counts.available,
    firstLatencyMs: counts.firstLatencyMs,
  };
}

/** Eq. (1) Hollow Rings: right omission rate − left omission rate. */
export function hollowRingsLateralIndex(left: SelectionCounts, right: SelectionCounts): number | null {
  if (left.available === 0 || right.available === 0) return null;
  return right.omissions / right.available - left.omissions / left.available;
}

export function hollowRingsObservation(left: SelectionCounts, right: SelectionCounts): TestObservation | null {
  const value = hollowRingsLateralIndex(left, right);
  if (value == null) return null;
  return {
    test: "cancellation",
    label: "Hollow Rings",
    value,
    se: seProportionDiff(right.omissions, right.available, left.omissions, left.available),
    n: left.available + right.available,
  };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function scoreTargetSelection(trial: TrialRecord): TargetSelectionScore {
  const byId = new Map(trial.layout.stimuli.map((stimulus) => [stimulus.id, stimulus]));
  const seen = new Set<string>();
  const orderedHits: OrderedHit[] = [];
  let distractors = 0;
  let repeats = 0;

  for (const event of sortEvents(trial.events)) {
    if (event.type === "pointer") continue;
    const stimulus = event.stimulusId ? byId.get(event.stimulusId) : undefined;
    if (!stimulus) continue;
    if (stimulus.kind === "distractor") {
      distractors += 1;
      continue;
    }
    if (seen.has(stimulus.id)) {
      repeats += 1;
      continue;
    }
    seen.add(stimulus.id);
    orderedHits.push({
      stimulusId: stimulus.id,
      seq: event.seq,
      elapsed: event.elapsed,
      x: event.x,
      y: event.y,
      side: stimulus.side,
      region: regionOfStimulus(stimulus),
      order: orderedHits.length + 1,
    });
  }

  const sideCounts = (side: BoardSide): SelectionCounts => {
    const available = trial.layout.stimuli.filter((stimulus) => stimulus.kind === "target" && stimulus.side === side).length;
    const hits = orderedHits.filter((hit) => hit.side === side);
    return withRate({
      hits: hits.length,
      available,
      firstLatencyMs: hits[0]?.elapsed ?? null,
    });
  };

  const regions = {
    "left-top": emptyCounts(),
    "left-middle": emptyCounts(),
    "left-bottom": emptyCounts(),
    "right-top": emptyCounts(),
    "right-middle": emptyCounts(),
    "right-bottom": emptyCounts(),
  } as Record<BoardRegion, SelectionCounts>;

  for (const region of Object.keys(regions) as BoardRegion[]) {
    const available = trial.layout.stimuli.filter(
      (stimulus) => stimulus.kind === "target" && regionOfStimulus(stimulus) === region,
    ).length;
    const hits = orderedHits.filter((hit) => hit.region === region);
    regions[region] = withRate({
      hits: hits.length,
      available,
      firstLatencyMs: hits[0]?.elapsed ?? null,
    });
  }

  const left = sideCounts("left");
  const right = sideCounts("right");
  const hits = left.hits + right.hits;
  const available = left.available + right.available;
  const pathDistance = orderedHits
    .slice(1)
    .reduce((total, hit, index) => total + Math.hypot(hit.x - orderedHits[index].x, hit.y - orderedHits[index].y), 0);

  return {
    valid: isScoredTrialEnd(trial.end),
    left,
    right,
    regions,
    hits,
    available,
    omissions: available - hits,
    hitRate: hits / (available || 1),
    omissionAsymmetry: left.omissionRate === null || right.omissionRate === null ? null : left.omissionRate - right.omissionRate,
    lateralIndex: hollowRingsLateralIndex(left, right),
    observation: hollowRingsObservation(left, right),
    firstLatencyMs: orderedHits[0]?.elapsed ?? null,
    distractors,
    repeats,
    pathDistance,
    orderedHits,
  };
}

export function scoreLineBisection(trial: TrialRecord): LineBisectionScore {
  const line = trial.line;
  const events = sortEvents(trial.events);
  const response =
    !line || !isScoredTrialEnd(trial.end)
      ? null
      : (events.find(
          (event) => event.type === "bisection" && isOnLineSegment(event, line, LINE_Y_TOLERANCE),
        ) ?? null);

  return {
    valid: isScoredTrialEnd(trial.end) && response !== null,
    error: response && line ? (100 * (response.x - lineMidpoint(line))) / lineLength(line) : null,
    responseElapsedMs: response?.elapsed ?? null,
    outOfBand: events.filter((event) => event.type === "out-of-band").length,
  };
}

export function summarizeLineBisection(trials: readonly TrialRecord[]): LineBisectionSummary {
  const lineTrials = trials.filter((trial) => trial.task === "line-bisection");
  const errors = lineTrials.map((trial) => scoreLineBisection(trial).error);
  const valid = errors.filter((error): error is number => error !== null);
  const signedMedian = valid.length >= 3 ? median(valid) : null;
  return {
    errors,
    validCount: valid.length,
    signedMedian,
    absoluteMedian: valid.length >= 3 ? median(valid.map(Math.abs)) : null,
    healthyRange: signedMedian == null ? null : compareToNorm(signedMedian, BISECTION_SIGNED_ERROR_PCT),
  };
}

export function summarizeSpatialPattern(score: TargetSelectionScore | null): SpatialPatternSummary {
  if (!score?.valid) {
    return {
      kind: "insufficient",
      description: "The target-selection trial is incomplete, so no spatial pattern is reported.",
      hitRate: 0,
      omissionAsymmetry: null,
      pathDistance: 0,
      firstLatencyMs: null,
      distractors: 0,
      repeats: 0,
      laterality: null,
    };
  }

  const index = score.lateralIndex;
  const laterality = compareToNorm(index, HOLLOW_RINGS_LATERAL_INDEX);
  let kind: SpatialPatternKind = "balanced";
  let description = "Omission laterality is within the healthy range.";

  if (score.hitRate < 0.5) {
    kind = "low-selection";
    description = "Fewer than half of the targets were selected, so laterality is not compared to the healthy range.";
  } else if (laterality.beyondCutoff && (index ?? 0) < 0) {
    kind = "left-omission";
    description = "Left-side omissions sit outside the healthy range for cancellation laterality.";
  } else if (laterality.beyondCutoff && (index ?? 0) > 0) {
    kind = "right-omission";
    description = "Right-side omissions sit outside the healthy range for cancellation laterality.";
  }

  return {
    kind,
    description,
    hitRate: score.hitRate,
    omissionAsymmetry: score.omissionAsymmetry,
    pathDistance: score.pathDistance,
    firstLatencyMs: score.firstLatencyMs,
    distractors: score.distractors,
    repeats: score.repeats,
    laterality: score.hitRate < 0.5 ? { ...laterality, text: description } : laterality,
  };
}

export function findTargetSelectionTrial(session: SessionRecord): TrialRecord | undefined {
  return session.trials.find((trial) => trial.task === "target-selection");
}

export function scoreSession(session: SessionRecord): ScoringResult {
  const trial = findTargetSelectionTrial(session) ?? null;
  const targetSelection = trial ? scoreTargetSelection(trial) : null;
  return {
    targetSelection,
    lineBisection: summarizeLineBisection(session.trials),
    responseOrder: targetSelection?.orderedHits ?? [],
    spatialPattern: summarizeSpatialPattern(targetSelection),
    practice: suggestPractice(targetSelection),
  };
}
