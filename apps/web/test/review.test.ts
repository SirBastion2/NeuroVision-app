import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BOARD_WIDTH,
  DEMONSTRATION_SESSIONS,
  findTargetSelectionTrial,
  scoreSession,
} from "@neurovision/domain";
import { ResponseOrderPlot } from "../src/components/ResponseOrderPlot.tsx";
import { History } from "../src/screens/History.tsx";
import { Review } from "../src/screens/Review.tsx";
import { SEARCH_DISTANCE_HINT, SEARCH_DISTANCE_LABEL, boardWidths } from "../src/lib/format.ts";

const session = DEMONSTRATION_SESSIONS[1]!;
const trial = findTargetSelectionTrial(session)!;
const score = scoreSession(session).targetSelection!;

const review = () =>
  renderToStaticMarkup(
    createElement(Review, {
      session,
      saveError: null,
      onPractice() {},
      onHistory() {},
      onHome() {},
    }),
  );

const plot = (showSearchOrder = false) =>
  renderToStaticMarkup(
    createElement(ResponseOrderPlot, {
      layout: trial.layout,
      orderedHits: score.orderedHits,
      events: trial.events,
      showSearchOrder,
    }),
  );

describe("session review board", () => {
  it("keeps results actions to Export JSON, History, and Home", () => {
    const html = review();
    assert.match(html, /Export JSON/);
    assert.match(html, />History</);
    assert.match(html, />Home</);
    assert.doesNotMatch(html, /Open Clinician Dashboard/);
    assert.doesNotMatch(html, /Clinician Dashboard/);
  });

  it("shows found vs missed on a clean board, with search order off by default", () => {
    const html = review();
    assert.match(html, /<h3>Targets<\/h3>/);
    assert.match(html, /Show search order/);
    assert.match(html, /Omissions by region/);
    assert.match(html, /half-fill left/);
    assert.match(html, /half-fill right/);
    assert.doesNotMatch(html, /search-path/);
    assert.doesNotMatch(html, /order-badge/);
    assert.doesNotMatch(html, /numbered in order/);
    assert.match(html, /class="key found"/);
    assert.match(html, /class="key missed"/);
  });

  it("hides numbers and the path until search order is shown", () => {
    const off = plot(false);
    assert.match(off, /Show search order/);
    assert.doesNotMatch(off, /search-path/);
    assert.doesNotMatch(off, /order-badge/);
    assert.doesNotMatch(off, /numbered in order/);
    assert.doesNotMatch(off, new RegExp(SEARCH_DISTANCE_LABEL));
    assert.match(off, /class="key found"/);
    assert.match(off, /class="key missed"/);

    const on = plot(true);
    assert.match(on, /search-path/);
    assert.match(on, /order-badge/);
    assert.match(on, /Found, numbered in order/);
    assert.match(on, new RegExp(SEARCH_DISTANCE_LABEL));
    assert.match(on, new RegExp(SEARCH_DISTANCE_HINT));
  });

  it("shows search distance in board widths, with a plain explanation", () => {
    const html = review();
    const widths = boardWidths(score.pathDistance);
    assert.match(html, new RegExp(SEARCH_DISTANCE_LABEL));
    assert.match(html, new RegExp(SEARCH_DISTANCE_HINT));
    assert.match(html, new RegExp(`>${widths}<`));
    assert.doesNotMatch(html, /board units/);
    assert.doesNotMatch(html, /Search path/);
    assert.equal(Number(widths), Number((score.pathDistance / BOARD_WIDTH).toFixed(1)));
  });

  it("keeps the clinician dashboard reachable from History", () => {
    const html = renderToStaticMarkup(
      createElement(History, {
        stored: { sessions: [session], rejected: 0, error: null },
        onOpen() {},
        onDelete() {},
        onHome() {},
        onClinicianDashboard() {},
      }),
    );
    assert.match(html, />Clinician Dashboard</);
  });
});
