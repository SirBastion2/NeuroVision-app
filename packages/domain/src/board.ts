export const BOARD_WIDTH = 960;
export const BOARD_HEIGHT = 540;
export const BOARD_MIDLINE_X = BOARD_WIDTH / 2;

/** Click-to-stimulus radius on the logical board. */
export const TARGET_HIT_RADIUS = 22;

/** Vertical slack for a line-bisection mark to count as on the line. */
export const LINE_Y_TOLERANCE = 24;

export const BOARD_COLUMNS_PER_SIDE = 4;
export const BOARD_ROWS = 6;
export const BOARD_CELL_ORIGIN_X = 62;
export const BOARD_CELL_ORIGIN_Y = 58;
export const BOARD_CELL_STEP_X = 103;
export const BOARD_CELL_STEP_Y = 84;

export type BoardSide = "left" | "right";
export type VerticalRegion = "top" | "middle" | "bottom";
export type BoardRegion = `${BoardSide}-${VerticalRegion}`;

export interface Point {
  x: number;
  y: number;
}

export interface BoardBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const BOARD_REGIONS: readonly BoardRegion[] = [
  "left-top",
  "left-middle",
  "left-bottom",
  "right-top",
  "right-middle",
  "right-bottom",
];

export function sideOfX(x: number): BoardSide {
  return x < BOARD_MIDLINE_X ? "left" : "right";
}

export function verticalRegionOfY(y: number): VerticalRegion {
  if (y < BOARD_HEIGHT / 3) return "top";
  if (y < (2 * BOARD_HEIGHT) / 3) return "middle";
  return "bottom";
}

export function regionOfPoint(point: Point): BoardRegion {
  return `${sideOfX(point.x)}-${verticalRegionOfY(point.y)}`;
}

export function regionOfStimulus(stimulus: { x: number; y: number; side: BoardSide }): BoardRegion {
  return `${stimulus.side}-${verticalRegionOfY(stimulus.y)}`;
}

/** Map a pointer in board-element pixels onto the fixed 960×540 logical board. */
export function toBoardCoordinates(clientX: number, clientY: number, box: BoardBox): Point {
  if (box.width <= 0 || box.height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: ((clientX - box.left) * BOARD_WIDTH) / box.width,
    y: ((clientY - box.top) * BOARD_HEIGHT) / box.height,
  };
}

export function viewportClass(width: number, height: number): "desktop-960" | "unsupported" {
  return width >= 1024 && height >= 768 ? "desktop-960" : "unsupported";
}

export function describeViewport(
  width: number,
  height: number,
  dpr = 1,
): { width: number; height: number; dpr: number; class: "desktop-960" | "unsupported" } {
  return { width, height, dpr, class: viewportClass(width, height) };
}

export function cellPosition(column: number, row: number): Point {
  return {
    x: BOARD_CELL_ORIGIN_X + column * BOARD_CELL_STEP_X,
    y: BOARD_CELL_ORIGIN_Y + row * BOARD_CELL_STEP_Y,
  };
}

export function mirrorX(x: number): number {
  return BOARD_WIDTH - x;
}
