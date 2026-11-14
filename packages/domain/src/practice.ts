import { PRACTICE_RULES_VERSION } from "./version.js";
import { createPracticeLayout, type BoardDensity, type TaskLayout } from "./layouts.js";
import type { PracticeCue, PracticeSuggestion } from "./session.js";

export type { PracticeCue };

export const PRACTICE_CUES: readonly PracticeCue[] = ["left", "right", "none"];
export const PRACTICE_LEVELS = [0, 1, 2] as const;

export interface PracticeScoreInput {
  valid: boolean;
  hitRate: number;
  omissionAsymmetry: number | null;
}

export interface PracticeChoice {
  cue: PracticeCue;
  density: BoardDensity;
  /** Self-paced row marker shown during the round. */
  scanGuide?: boolean;
}

export interface PracticeRoundSetup {
  config: PracticeSuggestion;
  layout: TaskLayout;
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

function choiceDiffers(choice: PracticeChoice, suggested: PracticeSuggestion): boolean {
  return (
    choice.cue !== suggested.cue ||
    choice.density !== suggested.density ||
    Boolean(choice.scanGuide) !== Boolean(suggested.scanGuide)
  );
}

function practiceExplanation(choice: PracticeChoice): string {
  const cue = choice.cue === "none" ? "Unguided practice" : `Cue the ${choice.cue} side`;
  const density = choice.density === "low" ? "on a lower-density board" : "on a standard-density board";
  const marker = choice.scanGuide ? " with a self-paced row marker" : "";
  return `${cue} ${density}${marker}.`;
}

/** Turn a chosen cue, density, and optional row marker into a practice round config plus layout. */
export function configurePracticeRound(
  choice: PracticeChoice,
  suggested: PracticeSuggestion | null = null,
): PracticeRoundSetup {
  const scanGuide = Boolean(choice.scanGuide);
  const matchesSuggestion = suggested !== null && !choiceDiffers(choice, suggested);
  const level: 0 | 1 | 2 = choice.cue === "none" ? 0 : matchesSuggestion ? suggested.level : 2;
  const config: PracticeSuggestion = {
    version: PRACTICE_RULES_VERSION,
    cue: choice.cue,
    density: choice.density,
    level,
    explanation: matchesSuggestion ? suggested.explanation : practiceExplanation(choice),
    metrics: suggested?.metrics ?? null,
    override:
      suggested && !matchesSuggestion
        ? "The chosen practice setup differs from the scored suggestion."
        : (suggested?.override ?? null),
    scanGuide,
  };
  return { config, layout: createPracticeLayout(choice.density) };
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
