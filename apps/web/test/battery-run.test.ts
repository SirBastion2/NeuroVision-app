import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CLOCK_DEFAULTS,
  GREYSCALES_DEFAULTS,
  combineEvidence,
  generateClockTrials,
  generateGreyscalesTrials,
  scoreClock,
  scoreGreyscales,
} from "@neurovision/domain";
import { ClockIntro } from "../src/checks/ClockTask.tsx";
import { GreyscalesIntro } from "../src/checks/GreyscalesTask.tsx";
import {
  assembleBatteryRecord,
  batteryEnabled,
  runnableBatterySteps,
} from "../src/data/batterySession.ts";
import { Home } from "../src/screens/Home.tsx";
import { batteryDisplay } from "../src/screens/BatteryResults.tsx";

describe("battery run wiring", () => {
  it("skips the scene placeholder and keeps clock, greyscales, and bisection", () => {
    assert.deepEqual(runnableBatterySteps("demo"), ["clock"]);
    assert.deepEqual(runnableBatterySteps("full"), ["clock", "greyscales", "bisection"]);
  });

  it("feeds ClockTask and GreyscalesTask domain outputs into a BatteryRecord", () => {
    const seed = 21;
    const clockTrials = generateClockTrials(CLOCK_DEFAULTS.demoTrials, seed);
    const greyTrials = generateGreyscalesTrials(GREYSCALES_DEFAULTS.trials, seed);
    const clockResponses = clockTrials.map((trial) => ({
      trialId: trial.id,
      choice: trial.correctPosition,
      rtMs: 640,
    }));
    const greyResponses = greyTrials.map((trial) => ({
      trialId: trial.id,
      choice: "top" as const,
      rtMs: 500,
    }));
    const clock = scoreClock(clockTrials, clockResponses);
    const grey = scoreGreyscales(greyTrials, greyResponses);
    const evidence = combineEvidence([clock.observation, grey.observation]);
    assert.equal(clock.observation.test, "clock");
    assert.equal(grey.observation.test, "greyscales");
    assert.ok(evidence.verdict.text.length > 0);
    assert.doesNotMatch(evidence.verdict.text, /diagnos|severity/i);

    const record = assembleBatteryRecord(
      { mode: "full", hide: "none", seed, readingDirection: "left-to-right", consent: true },
      {
        scene: { taps: [] },
        clock: { trials: clockTrials, responses: clockResponses },
        greyscales: { trials: greyTrials, responses: greyResponses },
      },
      { id: "battery-run-1", now: new Date("2026-11-14T12:00:00.000Z") },
    );
    assert.equal(record.clock.trials.length, clockTrials.length);
    assert.equal(record.greyscales?.trials.length, greyTrials.length);
    assert.equal(record.scene.taps.length, 0);
    const display = batteryDisplay(record);
    assert.equal(display.sceneRan, false);
    assert.ok(display.counted.every((row) => row.test !== "scene"));
    assert.equal(display.evidence.verdict.key, "no-data");
    assert.ok(display.counted.every((row) => row.test === "bisection"));
  });

  it("renders clock and greyscales intros with the current screen classes", () => {
    const clockHtml = renderToStaticMarkup(
      createElement(ClockIntro, { count: 10, step: "Test 1 of 2", onBegin() {}, onCancel() {} }),
    );
    assert.match(clockHtml, /class="intro card narrow"/);
    assert.match(clockHtml, /Spot the clock/);
    const greyHtml = renderToStaticMarkup(
      createElement(GreyscalesIntro, {
        count: 40,
        step: "Test 2 of 2",
        initialDirection: "left-to-right",
        onBegin() {},
        onCancel() {},
      }),
    );
    assert.match(greyHtml, /class="intro card narrow"/);
    assert.match(greyHtml, /class="segmented"/);
    assert.match(greyHtml, /Which bar looks darker/);
  });

  it("keeps the battery entry when the API client is on", () => {
    assert.equal(batteryEnabled(true), true);
    Object.assign(globalThis, {
      window: { innerWidth: 1280, innerHeight: 900, devicePixelRatio: 1 },
    });
    const hidden = renderToStaticMarkup(
      createElement(Home, {
        onStart() {},
        onOpen() {},
        onHistory() {},
        onProfile() {},
        onGaze() {},
        showBattery: false,
      }),
    );
    assert.doesNotMatch(hidden, /Spatial battery/);
    const shown = renderToStaticMarkup(
      createElement(Home, {
        onStart() {},
        onOpen() {},
        onHistory() {},
        onProfile() {},
        onGaze() {},
        showBattery: true,
        onBattery() {},
      }),
    );
    assert.match(shown, /Spatial battery/);
  });
});
