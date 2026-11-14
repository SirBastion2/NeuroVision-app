import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOME_JOURNEY_STEPS,
  SCORED_BATTERY,
  SCORED_BATTERY_COUNT,
  scoredBatteryName,
  scoredBatteryStep,
} from "../src/lib/battery-labels.ts";

describe("scored battery labels", () => {
  it("numbers every scored test against the full battery of three", () => {
    assert.equal(SCORED_BATTERY_COUNT, 3);
    assert.deepEqual(
      SCORED_BATTERY.map((test) => test.id),
      ["starry", "rings", "lines"],
    );
    assert.equal(scoredBatteryStep("starry"), "Test 1 of 3 · Starry Night");
    assert.equal(scoredBatteryStep("rings"), "Test 2 of 3 · Hollow rings");
    assert.equal(scoredBatteryStep("lines"), "Test 3 of 3 · Line bisection");
    assert.equal(scoredBatteryName("rings"), "Hollow rings");
  });

  it("keeps nav-opened tests on the same 1-of-3 scale", () => {
    assert.doesNotMatch(scoredBatteryStep("rings"), /of 2/i);
    assert.doesNotMatch(scoredBatteryStep("lines"), /of 1/i);
    assert.equal(scoredBatteryStep("rings").startsWith("Test 2 of 3"), true);
  });

  it("builds the Home journey from the same list, then Review", () => {
    assert.deepEqual(
      HOME_JOURNEY_STEPS.map((step) => `${step.n} ${step.title}`),
      ["01 Starry Night", "02 Hollow rings", "03 Line bisection", "04 Review"],
    );
    assert.equal(HOME_JOURNEY_STEPS[0]?.text, SCORED_BATTERY[0]?.blurb);
    assert.equal(HOME_JOURNEY_STEPS[1]?.text, SCORED_BATTERY[1]?.blurb);
    assert.equal(HOME_JOURNEY_STEPS[2]?.text, SCORED_BATTERY[2]?.blurb);
  });
});
