import { date, time } from "./format";

export type TrendTickAnchor = "start" | "middle" | "end";

export interface TrendAxisTick {
  index: number;
  text: string;
  x: number;
  anchor: TrendTickAnchor;
}

/** 10.5px tabular sans on the trend chart; slightly wide so labels never kiss. */
const CHAR_WIDTH = 6.8;
const LABEL_GAP = 12;

export function trendPointX(index: number, count: number, innerWidth: number, padLeft: number): number {
  if (count <= 1) return padLeft + innerWidth / 2;
  return padLeft + (index * innerWidth) / (count - 1);
}

export function trendTickAnchor(index: number, count: number): TrendTickAnchor {
  if (index === 0) return "start";
  if (index === count - 1) return "end";
  return "middle";
}

export function trendDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function estimateTrendLabelWidth(text: string, charWidth = CHAR_WIDTH): number {
  return Math.max(22, text.length * charWidth);
}

export function trendLabelBounds(x: number, width: number, anchor: TrendTickAnchor): { left: number; right: number } {
  if (anchor === "start") return { left: x, right: x + width };
  if (anchor === "end") return { left: x - width, right: x };
  const half = width / 2;
  return { left: x - half, right: x + half };
}

function evenlySpacedIndices(count: number, ticks: number): number[] {
  if (ticks >= count) return Array.from({ length: count }, (_, i) => i);
  if (ticks <= 1) return [0];
  const indices: number[] = [];
  for (let k = 0; k < ticks; k++) {
    const i = Math.round((k * (count - 1)) / (ticks - 1));
    if (indices.length === 0 || indices[indices.length - 1] !== i) indices.push(i);
  }
  return indices;
}

function compactTexts(
  timestamps: readonly string[],
  indices: readonly number[],
  formatDate: (iso: string) => string,
  formatTime: (iso: string) => string,
): string[] {
  const texts: string[] = [];
  let prevDay: string | null = null;
  for (const i of indices) {
    const iso = timestamps[i] ?? "";
    const day = trendDayKey(iso);
    texts.push(day === prevDay ? formatTime(iso) : formatDate(iso));
    prevDay = day;
  }
  return texts;
}

function ticksOverlap(
  indices: readonly number[],
  texts: readonly string[],
  count: number,
  x: (index: number) => number,
  gap: number,
  charWidth: number,
): boolean {
  let prevRight = -Infinity;
  for (let n = 0; n < indices.length; n++) {
    const i = indices[n]!;
    const box = trendLabelBounds(
      x(i),
      estimateTrendLabelWidth(texts[n] ?? "", charWidth),
      trendTickAnchor(i, count),
    );
    if (box.left < prevRight + gap) return true;
    prevRight = box.right;
  }
  return false;
}

/**
 * X-axis labels for session-order charts: one date per local day, time for later
 * same-day sessions, thinned to evenly spaced ticks that do not overlap.
 */
export function trendAxisTicks(
  timestamps: readonly string[],
  x: (index: number) => number,
  options?: {
    formatDate?: (iso: string) => string;
    formatTime?: (iso: string) => string;
    gap?: number;
    charWidth?: number;
  },
): TrendAxisTick[] {
  const count = timestamps.length;
  if (count === 0) return [];

  const formatDate = options?.formatDate ?? date;
  const formatTime = options?.formatTime ?? time;
  const gap = options?.gap ?? LABEL_GAP;
  const charWidth = options?.charWidth ?? CHAR_WIDTH;

  const chosen = (): { indices: number[]; texts: string[] } => {
    if (count === 1) return { indices: [0], texts: compactTexts(timestamps, [0], formatDate, formatTime) };
    for (let ticks = count; ticks >= 2; ticks--) {
      const indices = evenlySpacedIndices(count, ticks);
      const texts = compactTexts(timestamps, indices, formatDate, formatTime);
      if (!ticksOverlap(indices, texts, count, x, gap, charWidth)) return { indices, texts };
    }
    const indices = [0, count - 1];
    return { indices, texts: compactTexts(timestamps, indices, formatDate, formatTime) };
  };

  const { indices, texts } = chosen();
  return indices.map((index, n) => ({
    index,
    text: texts[n] ?? "",
    x: x(index),
    anchor: trendTickAnchor(index, count),
  }));
}
