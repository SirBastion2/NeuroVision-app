import type { Difficulty } from "../metrics/types";
import { clamp } from "../metrics/math";

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;
export const DEFAULT_LEVEL = 2;

/** Level 1 = sparse, large targets, long limit. Level 5 = dense, small, short. */
export function difficultyForLevel(level: number): Difficulty {
  const l = clamp(Math.round(level), MIN_LEVEL, MAX_LEVEL);
  const f = (l - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL);
  return {
    level: l,
    distractorDensity: +(0.6 + 0.9 * f).toFixed(2),
    targetScale: +(1.3 - 0.45 * f).toFixed(2),
    timeLimitMs: Math.round(150_000 - 75_000 * f),
  };
}

export interface RunOutcome {
  difficulty: Difficulty;
  hitRate: number;
  timedOut: boolean;
  commissions: number;
}

/**
 * One-up/one-down staircase on the most recent run: raise the level after an easy run
 * (≥ 90% found, in time, ≤ 2 wrong taps), lower it after a struggling run (< 60% found or
 * timed out with < 80% found), otherwise hold. With no history, start at DEFAULT_LEVEL.
 */
export function nextDifficulty(history: readonly RunOutcome[]): Difficulty {
  const last = history[history.length - 1];
  if (!last) return difficultyForLevel(DEFAULT_LEVEL);
  const easy = last.hitRate >= 0.9 && !last.timedOut && last.commissions <= 2;
  const struggling = last.hitRate < 0.6 || (last.timedOut && last.hitRate < 0.8);
  const step = easy ? 1 : struggling ? -1 : 0;
  return difficultyForLevel(last.difficulty.level + step);
}
