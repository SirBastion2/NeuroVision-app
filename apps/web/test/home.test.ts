import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HOME_JOURNEY_STEPS } from "../src/lib/battery-labels.ts";
import { Home } from "../src/screens/Home.tsx";

Object.defineProperty(globalThis, "window", {
  value: { innerWidth: 1400, innerHeight: 900 },
  configurable: true,
});

function renderHome() {
  return renderToStaticMarkup(
    createElement(Home, {
      onStart() {},
      onHistory() {},
      onProfile() {},
      onDemo() {},
    }),
  );
}

describe("Home hero", () => {
  it("lists the scored battery, Review, and Practice, and names three short tasks", () => {
    const html = renderHome();
    assert.match(html, /Three short tasks record every response/);
    assert.match(html, /it is not a diagnosis/);
    assert.doesNotMatch(html, /Two short board tasks/);
    for (const step of HOME_JOURNEY_STEPS) {
      assert.match(html, new RegExp(`>${step.n}<`));
      assert.match(html, new RegExp(`<strong>${step.title}</strong>`));
      assert.match(html, new RegExp(step.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(html, /Target selection/);
    assert.doesNotMatch(html, /Participant alias/);
    assert.doesNotMatch(html, /Gaze lab/);
    assert.doesNotMatch(html, /Spatial battery/);
    assert.doesNotMatch(html, /Three patterns/);
    assert.match(html, /History/);
    assert.match(html, /My Profile/);
    assert.match(html, /Demo run/);
  });
});
