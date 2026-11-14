export interface BoardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BoardPoint {
  x: number;
  y: number;
  outOfBoard: boolean;
}

/** Out-of-board samples are recorded — never clamped into edge targets. */
export function viewportToBoard(
  viewportX: number,
  viewportY: number,
  board: BoardRect,
): BoardPoint {
  const boardX = viewportX - board.left;
  const boardY = viewportY - board.top;
  const outOfBoard =
    boardX < 0 ||
    boardY < 0 ||
    boardX > board.width ||
    boardY > board.height;
  return { x: boardX, y: boardY, outOfBoard };
}

export function distancePx(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
