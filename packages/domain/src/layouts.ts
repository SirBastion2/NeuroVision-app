import {
  BOARD_COLUMNS_PER_SIDE,
  BOARD_ROWS,
  cellPosition,
  mirrorX,
  type BoardSide,
} from "./board.js";

export type StimulusKind = "target" | "distractor";
export type TaskKind = "target-selection" | "line-bisection";
export type LayoutVariant = "fixed-a" | "fixed-b";
export type BoardDensity = "standard" | "low";
export type LayoutVariantFamily = "assessment-fixed" | "practice" | "line-bisection";

export interface Stimulus {
  id: string;
  x: number;
  y: number;
  kind: StimulusKind;
  side: BoardSide;
}

export interface TaskLayout {
  id: string;
  stimuli: Stimulus[];
}

export interface LineSegment {
  x1: number;
  y: number;
  x2: number;
}

export const LINE_BISECTION_LINES: readonly LineSegment[] = [
  { x1: 120, x2: 720, y: 240 },
  { x1: 300, x2: 700, y: 300 },
  { x1: 160, x2: 860, y: 270 },
  { x1: 260, x2: 460, y: 220 },
  { x1: 230, x2: 730, y: 290 },
];

export const LINE_BISECTION_TRIAL_COUNT = LINE_BISECTION_LINES.length;

interface SlotCounts {
  targetsPerSide: number;
  distractorsPerSide: number;
}

function slotCounts(kind: "assessment" | "practice", density: BoardDensity): SlotCounts {
  if (kind === "assessment") {
    return { targetsPerSide: 12, distractorsPerSide: 12 };
  }
  if (density === "low") {
    return { targetsPerSide: 6, distractorsPerSide: 3 };
  }
  return { targetsPerSide: 8, distractorsPerSide: 6 };
}

/** Deterministic mixer used only to shuffle the shared 4×6 slot order. */
function createSlotMixer(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffledSlots(seed: number): Array<{ x: number; y: number }> {
  const next = createSlotMixer(seed);
  const slots = Array.from({ length: BOARD_COLUMNS_PER_SIDE * BOARD_ROWS }, (_, index) => {
    const column = index % BOARD_COLUMNS_PER_SIDE;
    const row = Math.floor(index / BOARD_COLUMNS_PER_SIDE);
    return { ...cellPosition(column, row), sort: next() };
  });
  slots.sort((a, b) => a.sort - b.sort);
  return slots.map(({ x, y }) => ({ x, y }));
}

function layoutSeed(variant: LayoutVariant | "practice"): number {
  if (variant === "fixed-b") return 943;
  if (variant === "practice") return 818;
  return 417;
}

function fillSides(slots: Array<{ x: number; y: number }>, counts: SlotCounts): Stimulus[] {
  const filled: Stimulus[] = [];
  const perSide = counts.targetsPerSide + counts.distractorsPerSide;
  for (const side of ["left", "right"] as const) {
    for (let index = 0; index < perSide; index += 1) {
      const slot = slots[index];
      const isTarget = index < counts.targetsPerSide;
      const ordinal = isTarget ? index + 1 : index - counts.targetsPerSide + 1;
      filled.push({
        id: `${side}-${isTarget ? "t" : "d"}${ordinal}`,
        x: side === "left" ? slot.x : mirrorX(slot.x),
        y: slot.y,
        kind: isTarget ? "target" : "distractor",
        side,
      });
    }
  }
  return filled;
}

export function createTargetSelectionLayout(
  variant: LayoutVariant = "fixed-a",
  density: BoardDensity = "standard",
): TaskLayout {
  const counts = slotCounts("assessment", density);
  return {
    id: variant,
    stimuli: fillSides(shuffledSlots(layoutSeed(variant)), counts),
  };
}

export function layoutVariantFamily(layout: TaskLayout | string): LayoutVariantFamily | null {
  const id = typeof layout === "string" ? layout : layout.id;
  if (id === "fixed-a" || id === "fixed-b") return "assessment-fixed";
  if (id.startsWith("practice-")) return "practice";
  if (id.startsWith("line-bisection-")) return "line-bisection";
  return null;
}

export function createPracticeLayout(density: BoardDensity = "standard"): TaskLayout {
  const counts = slotCounts("practice", density);
  return {
    id: `practice-${density}-v1`,
    stimuli: fillSides(shuffledSlots(layoutSeed("practice")), counts),
  };
}

export function createLineBisectionLayout(index: number): { layout: TaskLayout; line: LineSegment } {
  const line = LINE_BISECTION_LINES[index];
  if (!line) {
    throw new RangeError(`Line bisection index ${index} is out of range.`);
  }
  return {
    layout: { id: `line-bisection-${index}`, stimuli: [] },
    line: { ...line },
  };
}

export function lineMidpoint(line: LineSegment): number {
  return (line.x1 + line.x2) / 2;
}

export function lineLength(line: LineSegment): number {
  return line.x2 - line.x1;
}

export function isOnLineSegment(point: { x: number; y: number }, line: LineSegment, yTolerance: number): boolean {
  return point.x >= line.x1 && point.x <= line.x2 && Math.abs(point.y - line.y) <= yTolerance;
}
