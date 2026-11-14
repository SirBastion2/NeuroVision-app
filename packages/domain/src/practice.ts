import { PRACTICE_RULES_VERSION } from "./version.js";
import type { PracticeCue, PracticeSuggestion } from "./session.js";

export type { PracticeCue };

export const PRACTICE_CUES: readonly PracticeCue[] = ["left", "right", "none"];
export const PRACTICE_LEVELS = [0, 1, 2] as const;

export interface PracticeScoreInput {
  valid: boolean;
  hitRate: number;
  omissionAsymmetry: number | null;
}

const LOW_SELECTION_HIT_RATE = 0.5;
const SIDE_GAP_POINTS = 25;
const FADE_HIT_RATE = 0.85;
const FADE_SIDE_GAP_POINTS = 10;

function emptySuggestion(explanation: string): PracticeSuggestion {
  return {
    version: PRACTICE_RULES_VERSION,
    cue: "none",
    density: "standard",
    level: 0,
    explanation,
    metrics: null,
    override: null,
  };
}

export function suggestPractice(score: PracticeScoreInput | null): PracticeSuggestion {
  if (!score?.valid) {
    return emptySuggestion("No usable target-selection trial. Use an unguided familiarization board.");
  }

  const asymmetry = score.omissionAsymmetry ?? 0;
  const base: PracticeSuggestion = {
    version: PRACTICE_RULES_VERSION,
    cue: "none",
    density: "standard",
    level: 0,
    explanation: "",
    metrics: { hitRate: score.hitRate, asymmetry },
    override: null,
  };

  if (score.hitRate < LOW_SELECTION_HIT_RATE) {
    return {
      ...base,
      density: "low",
      explanation:
        "Fewer than 50% of targets were selected. Start with a lower-density board and no side cue.",
    };
  }

  if (asymmetry >= SIDE_GAP_POINTS) {
    return {
      ...base,
      cue: "left",
      level: 2,
      explanation:
        "Left omissions exceed right omissions by at least 25 percentage points. Cue the left side and scan left to right.",
    };
  }

  if (asymmetry <= -SIDE_GAP_POINTS) {
    return {
      ...base,
      cue: "right",
      level: 2,
      explanation:
        "Right omissions exceed left omissions by at least 25 percentage points. Cue the right side and scan right to left.",
    };
  }

  return {
    ...base,
    explanation:
      "At least 50% of targets were selected and the side gap is below 25 points. Use standard unguided practice.",
  };
}

export function fadePracticeCue(
  rounds: readonly { score: PracticeScoreInput; config: PracticeSuggestion }[],
  current: PracticeSuggestion,
): PracticeSuggestion {
  const recent = rounds.slice(-2);
  if (recent.length < 2 || current.level === 0) return current;

  const ready = recent.every(({ score, config }) => {
    return (
      score.valid &&
      score.hitRate >= FADE_HIT_RATE &&
      Math.abs(score.omissionAsymmetry ?? Number.POSITIVE_INFINITY) <= FADE_SIDE_GAP_POINTS &&
      config.cue === current.cue &&
      config.density === current.density &&
      config.level === current.level &&
      (config.scanGuide ?? false) === (current.scanGuide ?? false)
    );
  });

  if (!ready) return current;

  const nextLevel = (current.level - 1) as 0 | 1 | 2;
  return {
    ...current,
    level: nextLevel,
    explanation:
      "Two consecutive rounds at this configuration reached 85% hits with a side gap of at most 10 points. Fade the cue by one level.",
  };
}
