import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HOME_JOURNEY_STEPS } from "../src/lib/battery-labels.ts";
import { Home } from "../src/screens/Home.tsx";
import { TargetIntro } from "../src/screens/Intros.tsx";

Object.defineProperty(globalThis, "window", {
  value: { innerWidth: 1400, innerHeight: 900 },
  configurable: true,
});

function renderHome() {
  return renderToStaticMarkup(
    createElement(Home, {
      onStart() {},
      onHistory() {},
      onDemo() {},
    }),
  );
}

describe("Home hero", () => {
  it("lists the scored battery and Review, and names three short tasks", () => {
    const html = renderHome();
    assert.match(html, /Three short tasks record every response/);
    assert.match(html, /it is not a diagnosis/);
    assert.match(html, /Starry Night, hollow rings and line bisection/);
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
    assert.doesNotMatch(html, /My Profile/);
    assert.doesNotMatch(html, /Clinician/);
    assert.doesNotMatch(html, /from this browser/);
    assert.doesNotMatch(html, /Practice/);
    assert.doesNotMatch(html, /practice setup/);
    assert.doesNotMatch(html, /practice rounds/);
    assert.match(html, /History/);
    assert.match(html, /Sessions over time/);
    assert.match(html, /Demo run/);
    assert.match(html, /Begin assessment/);
    assert.match(html, /New session/);
    assert.doesNotMatch(html, /Start an assessment/);
    assert.doesNotMatch(html, /A few minutes/);
    assert.doesNotMatch(html, /Data stays in this browser/);
    assert.doesNotMatch(html, />Input</);
    assert.doesNotMatch(html, /Mouse or trackpad/);
    assert.doesNotMatch(html, /Keyboard cursor/);
    assert.doesNotMatch(html, /Board layout/);
    assert.doesNotMatch(html, /Layout A/);
    assert.doesNotMatch(html, /Layout B/);
  });
});

describe("hollow rings intro", () => {
  it("does not use the old Target selection name", () => {
    const html = renderToStaticMarkup(
      createElement(TargetIntro, {
        input: "mouse-trackpad",
        onBegin() {},
        onCancel() {},
      }),
    );
    assert.match(html, /Start hollow rings/);
    assert.match(html, /Test 2 of 3/);
    assert.doesNotMatch(html, /Target selection/);
  });
});
