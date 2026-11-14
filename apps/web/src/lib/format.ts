import { BOARD_WIDTH } from "@neurovision/domain";

export const pct = (value: number | null, digits = 0) => (value === null ? "n/a" : `${(value * 100).toFixed(digits)}%`);
export const points = (value: number | null, digits = 1) =>
  value === null ? "n/a" : `${value > 0 ? "+" : ""}${value.toFixed(digits)} pts`;
export const seconds = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(2)} s`);
export const signedPct = (value: number | null) =>
  value === null ? "n/a" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Summed tap-to-tap distance, shown as how many board widths were travelled. */
export const SEARCH_DISTANCE_LABEL = "Search distance";
export const SEARCH_DISTANCE_HINT = "Total distance moved between taps, in board widths";

/** Left omission rate minus right omission rate, in percentage points. */
export const LEFT_RIGHT_MISSES_LABEL = "Left vs right misses";
export const LEFT_RIGHT_MISSES_HINT =
  "Share of left-side targets missed minus share of right-side targets missed";

export const boardWidths = (distance: number, digits = 1) =>
  Number.isFinite(distance) ? (distance / BOARD_WIDTH).toFixed(digits) : "n/a";

export const missShareGap = (value: number | null, digits = 0) => {
  if (value === null) return "n/a";
  const abs = Number(Math.abs(value).toFixed(digits));
  if (abs === 0) return "same share missed on both sides";
  const pts = Number.isInteger(abs) ? String(abs) : abs.toFixed(digits);
  return value > 0 ? `${pts} pts more missed on the left` : `${pts} pts more missed on the right`;
};
