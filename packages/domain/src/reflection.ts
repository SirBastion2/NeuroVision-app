import {
  scoreTargetSelection,
  summarizeSpatialPattern,
  type OrderedHit,
  type SpatialPatternKind,
  type SpatialPatternSummary,
  type TargetSelectionScore,
} from "./scoring.js";
import type { TrialRecord } from "./session.js";

export interface PracticeVersusAssessment {
  hitRateDelta: number;
  hits: { left: number; right: number };
  omissions: { left: number; right: number };
  assessmentPattern: SpatialPatternKind;
  practicePattern: SpatialPatternKind;
}

export interface PracticeReflection {
  hits: { left: number; right: number };
  omissions: { left: number; right: number };
  orderedHits: OrderedHit[];
  hitRate: number;
  omissionAsymmetry: number | null;
  pattern: SpatialPatternSummary;
  versusAssessment: PracticeVersusAssessment | null;
}

function sideDelta(practice: TargetSelectionScore, assessment: TargetSelectionScore, side: "left" | "right") {
  return {
    hits: practice[side].hits - assessment[side].hits,
    omissions: practice[side].omissions - assessment[side].omissions,
  };
}

/** Hits per side, omissions, response order, and change versus the assessment target-selection score. */
export function reflectPracticeRound(
  trial: TrialRecord,
  assessment: TargetSelectionScore | null = null,
): PracticeReflection {
  const score = scoreTargetSelection(trial);
  const pattern = summarizeSpatialPattern(score);
  const versusAssessment =
    assessment === null
      ? null
      : {
          hitRateDelta: score.hitRate - assessment.hitRate,
          hits: {
            left: sideDelta(score, assessment, "left").hits,
            right: sideDelta(score, assessment, "right").hits,
          },
          omissions: {
            left: sideDelta(score, assessment, "left").omissions,
            right: sideDelta(score, assessment, "right").omissions,
          },
          assessmentPattern: summarizeSpatialPattern(assessment).kind,
          practicePattern: pattern.kind,
        };

  return {
    hits: { left: score.left.hits, right: score.right.hits },
    omissions: { left: score.left.omissions, right: score.right.omissions },
    orderedHits: score.orderedHits,
    hitRate: score.hitRate,
    omissionAsymmetry: score.omissionAsymmetry,
    pattern,
    versusAssessment,
  };
}
