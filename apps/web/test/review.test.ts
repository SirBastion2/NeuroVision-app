import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BOARD_WIDTH, findTargetSelectionTrial, scoreSession } from "@neurovision/domain";
import { makeSession } from "../../../packages/domain/test/session-factory.ts";
import { ResponseOrderPlot } from "../src/components/ResponseOrderPlot.tsx";
import { History } from "../src/screens/History.tsx";
import { Review } from "../src/screens/Review.tsx";
import {
  LEFT_RIGHT_MISSES_HINT,
  LEFT_RIGHT_MISSES_LABEL,
  SEARCH_DISTANCE_HINT,
  SEARCH_DISTANCE_LABEL,
  WRONG_TAPS_LABEL,
  boardWidths,
  missShareGap,
  wrongTapsHint,
} from "../src/lib/format.ts";

const session = makeSession({
  id: "review-left",
  alias: "Left-omission",
  leftHits: 6,
  rightHits: 12,
});
const trial = findTargetSelectionTrial(session)!;
const score = scoreSession(session).targetSelection!;

const review = () =>
  renderToStaticMarkup(
    createElement(Review, {
      session,
      saveError: null,
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
    assert.doesNotMatch(html, /Set up practice/);
    assert.doesNotMatch(html, /Practice suggestion/);
    assert.doesNotMatch(html, /Another practice round/);
    assert.doesNotMatch(html, /Cue the /);
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

  it("names left vs right misses from left minus right omission rate", () => {
    assert.equal(score.omissionAsymmetry, 50);
    assert.equal(missShareGap(score.omissionAsymmetry), "50 pts more missed on the left");
    assert.equal(missShareGap(-50), "50 pts more missed on the right");
    assert.equal(missShareGap(0), "same share missed on both sides");
    assert.equal(missShareGap(null), "n/a");
  });

  it("shows left vs right misses with a plain explanation", () => {
    const html = review();
    assert.match(html, new RegExp(LEFT_RIGHT_MISSES_LABEL));
    assert.match(html, new RegExp(LEFT_RIGHT_MISSES_HINT));
    assert.match(html, /50 pts more missed on the left/);
    assert.doesNotMatch(html, /Omission gap/);
    assert.doesNotMatch(html, />percentage points</);
  });

  it("uses singular and plural repeat taps in the wrong-taps line", () => {
    assert.equal(wrongTapsHint(0), "Solid disks tapped by mistake · 0 repeat taps on found rings");
    assert.equal(wrongTapsHint(1), "Solid disks tapped by mistake · 1 repeat tap on found rings");
    assert.equal(wrongTapsHint(2), "Solid disks tapped by mistake · 2 repeat taps on found rings");
  });

  it("shows wrong taps with a plain explanation of disks and repeats", () => {
    const html = review();
    assert.match(html, new RegExp(WRONG_TAPS_LABEL));
    assert.match(html, new RegExp(wrongTapsHint(score.repeats)));
    assert.match(html, new RegExp(`>${score.distractors}<`));
    assert.doesNotMatch(html, /Disks selected/);
  });

  it("keeps History as the session list with trend columns, and no clinician dashboard", () => {
    const html = renderToStaticMarkup(
      createElement(History, {
        stored: { sessions: [session], rejected: 0, error: null },
        onOpen() {},
        onDelete() {},
        onHome() {},
      }),
    );
    assert.match(html, /Sessions over time/);
    assert.match(html, />Participant</);
    assert.match(html, />Rings found</);
    assert.doesNotMatch(html, />Practice</);
    assert.match(html, /Left vs right/);
    assert.doesNotMatch(html, />Alias</);
    assert.doesNotMatch(html, /My Profile/);
    assert.doesNotMatch(html, /Clinician Dashboard/);
    assert.doesNotMatch(html, /Omission gap/);
  });
});
