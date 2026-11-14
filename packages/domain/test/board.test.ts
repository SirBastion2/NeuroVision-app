import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOARD_HEIGHT,
  BOARD_MIDLINE_X,
  BOARD_WIDTH,
  classifyResponse,
  createLineBisectionLayout,
  regionOfPoint,
  toBoardCoordinates,
  viewportClass,
} from "../src/index.ts";

describe("board geometry", () => {
  it("maps element pixels onto the 960×540 board", () => {
    const point = toBoardCoordinates(100, 60, { left: 20, top: 10, width: 480, height: 270 });
    assert.equal(point.x, 160);
    assert.equal(point.y, 100);
  });

  it("splits the board into left/right sides and vertical thirds", () => {
    assert.equal(regionOfPoint({ x: 10, y: 10 }), "left-top");
    assert.equal(regionOfPoint({ x: BOARD_MIDLINE_X, y: BOARD_HEIGHT / 2 }), "right-middle");
    assert.equal(regionOfPoint({ x: BOARD_WIDTH - 1, y: BOARD_HEIGHT - 1 }), "right-bottom");
  });

  it("requires a desktop-sized viewport for the 960 board class", () => {
    assert.equal(viewportClass(1280, 900), "desktop-960");
    assert.equal(viewportClass(800, 600), "unsupported");
  });

  it("classifies bisection versus out-of-band marks", () => {
    const { layout, line } = createLineBisectionLayout(0);
    const onLine = classifyResponse({
      sessionId: "geo",
      trialId: "line-0",
      task: "line-bisection",
      layout,
      line,
      existing: [],
      point: { x: (line.x1 + line.x2) / 2, y: line.y },
      elapsed: 200,
    });
    const off = classifyResponse({
      sessionId: "geo",
      trialId: "line-0",
      task: "line-bisection",
      layout,
      line,
      existing: [onLine],
      point: { x: 4, y: 4 },
      elapsed: 400,
    });
    assert.equal(onLine.type, "bisection");
    assert.equal(off.type, "out-of-band");
  });
});
