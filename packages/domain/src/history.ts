import { CONTRACTS_VERSION } from "./version.js";
import { layoutVariantFamily } from "./layouts.js";
import {
  findTargetSelectionTrial,
  scoreSession,
  type ScoringResult,
  type SpatialPatternKind,
} from "./scoring.js";
import type { SessionRecord } from "./session.js";

export interface ComparabilityKey {
  protocol: string;
  scorer: string;
  contractsVersion: string;
  layoutFamily: "assessment-fixed";
}

export type TrendExclusionReason = "demonstration" | "practice" | "unscored" | "incomparable";

export interface AssessmentTrendPoint {
  sessionId: string;
  alias: string;
  completedAt: string;
  hitRate: number;
  hits: number;
  omissions: number;
  omissionsLeft: number;
  omissionsRight: number;
  omissionAsymmetry: number | null;
  patternKind: SpatialPatternKind;
  bisectionSignedMedian: number | null;
}

export interface AssessmentTrend {
  key: ComparabilityKey | null;
  points: AssessmentTrendPoint[];
  excluded: Array<{ sessionId: string; reason: TrendExclusionReason }>;
}

export function comparabilityKey(session: SessionRecord): ComparabilityKey | null {
  const trial = findTargetSelectionTrial(session);
  if (!trial) return null;
  const family = layoutVariantFamily(trial.layout);
  if (family !== "assessment-fixed") return null;
  return {
    protocol: session.protocol,
    scorer: session.scorer,
    contractsVersion: CONTRACTS_VERSION,
    layoutFamily: family,
  };
}

export function sameComparabilityKey(a: ComparabilityKey, b: ComparabilityKey): boolean {
  return (
    a.protocol === b.protocol &&
    a.scorer === b.scorer &&
    a.contractsVersion === b.contractsVersion &&
    a.layoutFamily === b.layoutFamily
  );
}

/** Two scored assessment sessions are comparable when protocol, scorer, contracts version, and layout family match. */
export function areSessionsComparable(a: SessionRecord, b: SessionRecord): boolean {
  const keyA = comparabilityKey(a);
  const keyB = comparabilityKey(b);
  return keyA !== null && keyB !== null && sameComparabilityKey(keyA, keyB);
}

function trendPoint(session: SessionRecord, scored: ScoringResult): AssessmentTrendPoint | null {
  const target = scored.targetSelection;
  if (!target?.valid) return null;
  return {
    sessionId: session.id,
    alias: session.alias,
    completedAt: session.completedAt,
    hitRate: target.hitRate,
    hits: target.hits,
    omissions: target.omissions,
    omissionsLeft: target.left.omissions,
    omissionsRight: target.right.omissions,
    omissionAsymmetry: target.omissionAsymmetry,
    patternKind: scored.spatialPattern.kind,
    bisectionSignedMedian: scored.lineBisection.signedMedian,
  };
}

/**
 * Trend across comparable live assessment sessions.
 * Practice layouts and demonstration records are omitted from the points list.
 */
export function summarizeAssessmentTrend(sessions: readonly SessionRecord[]): AssessmentTrend {
  const excluded: AssessmentTrend["excluded"] = [];
  const eligible: Array<{ session: SessionRecord; key: ComparabilityKey; point: AssessmentTrendPoint }> = [];

  for (const session of sessions) {
    if (session.source === "demonstration") {
      excluded.push({ sessionId: session.id, reason: "demonstration" });
      continue;
    }

    const key = comparabilityKey(session);
    if (!key) {
      excluded.push({ sessionId: session.id, reason: "practice" });
      continue;
    }

    const point = trendPoint(session, scoreSession(session));
    if (!point) {
      excluded.push({ sessionId: session.id, reason: "unscored" });
      continue;
    }

    eligible.push({ session, key, point });
  }

  eligible.sort(
    (a, b) => a.session.completedAt.localeCompare(b.session.completedAt) || a.session.id.localeCompare(b.session.id),
  );

  const key = eligible[0]?.key ?? null;
  const points: AssessmentTrendPoint[] = [];

  for (const item of eligible) {
    if (!key || !sameComparabilityKey(item.key, key)) {
      excluded.push({ sessionId: item.session.id, reason: "incomparable" });
      continue;
    }
    points.push(item.point);
  }

  return { key, points, excluded };
}
