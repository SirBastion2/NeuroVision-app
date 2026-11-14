import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_NORMS,
  generateBisectionLines,
  generateClockTrials,
  generateGreyscalesTrials,
  generateScene,
  parseBatteryRecord,
  scoreBatteryRecord,
} from "@neurovision/domain";
import { createBatteryStore, memoryStore } from "@neurovision/storage";
import {
  assembleBatteryRecord,
  batteryEnabled,
  batteryStepOrder,
  runnableBatterySteps,
  saveBatterySession,
  shouldPersistBattery,
  type BatteryIntroConfig,
  type BatteryTaskOutputs,
} from "../src/data/batterySession.ts";

function outputs(seed: number, hide: BatteryIntroConfig["hide"]): BatteryTaskOutputs {
  const scene = generateScene({ seed, hide });
  const taps = scene.lanterns
    .filter((lantern) => lantern.lit && lantern.x >= scene.visible.x0 && lantern.x < scene.visible.x1)
    .slice(0, 5)
    .map((lantern, index) => ({ t: index * 400, x: lantern.x, y: lantern.y }));
  const clockTrials = generateClockTrials(4, seed);
  const greyTrials = generateGreyscalesTrials(4, seed);
  const lines = generateBisectionLines(4, seed);
  return {
    scene: { taps },
    clock: {
      trials: clockTrials,
      responses: clockTrials.map((trial) => ({ trialId: trial.id, choice: trial.correctPosition, rtMs: 800 })),
    },
    greyscales: {
      trials: greyTrials,
      responses: greyTrials.map((trial) => ({ trialId: trial.id, choice: "top" as const, rtMs: 700 })),
    },
    bisection: {
      lines,
      responses: lines.map((line) => ({ lineId: line.id, x: (line.x1 + line.x2) / 2 })),
    },
  };
}

describe("batterySession", () => {
  it("saves, reloads, and rescores demo and full records identically", async () => {
    const kv = memoryStore();
    const store = createBatteryStore(kv);
    const demoConfig: BatteryIntroConfig = {
      mode: "demo",
      hide: "left",
      seed: 11,
      readingDirection: null,
      consent: false,
    };
    const fullConfig: BatteryIntroConfig = {
      mode: "full",
      hide: "right",
      seed: 11,
      readingDirection: "left-to-right",
      consent: true,
    };

    const demoSaved = await saveBatterySession(demoConfig, outputs(11, "left"), {
      store,
      id: "battery-demo",
      startedAt: "2026-11-14T12:00:00.000Z",
      completedAt: "2026-11-14T12:04:00.000Z",
    });
    const fullSaved = await saveBatterySession(fullConfig, outputs(11, "none"), {
      store,
      id: "battery-full",
      startedAt: "2026-11-14T12:00:00.000Z",
      completedAt: "2026-11-14T12:08:00.000Z",
    });

    assert.equal(await store.load(demoSaved.id), null);
    const fullLoaded = parseBatteryRecord(await store.load(fullSaved.id));
    assert.deepEqual(scoreBatteryRecord(fullLoaded), scoreBatteryRecord(fullSaved));
    assert.deepEqual(fullLoaded, fullSaved);
    assert.equal(scoreBatteryRecord(demoSaved).clock.observation.test, "clock");
    assert.equal(shouldPersistBattery(demoSaved), false);
    assert.equal(shouldPersistBattery(fullSaved), true);

    assert.equal(demoSaved.source, "demonstration");
    assert.equal(demoSaved.mode, "demo");
    assert.equal(demoSaved.hide, "left");
    assert.equal(demoSaved.greyscales, null);
    assert.equal(demoSaved.bisection, null);
    assert.deepEqual(Object.keys(demoSaved.normsUsed).sort(), ["clock", "scene"]);
    assert.deepEqual(demoSaved.normsUsed.scene, DEFAULT_NORMS.scene);
    assert.deepEqual(demoSaved.normsUsed.clock, DEFAULT_NORMS.clock);

    assert.equal(fullSaved.source, "live");
    assert.equal(fullSaved.hide, "none");
    assert.ok(fullSaved.greyscales);
    assert.ok(fullSaved.bisection);
    assert.deepEqual(Object.keys(fullSaved.normsUsed).sort(), ["bisection", "clock", "greyscales", "scene"]);
    assert.deepEqual(fullSaved.normsUsed.greyscales, DEFAULT_NORMS.greyscales);
    assert.deepEqual(fullSaved.normsUsed.bisection, DEFAULT_NORMS.bisection);
  });

  it("marks every demo run as demonstration even if extra tests are supplied", () => {
    const record = assembleBatteryRecord(
      { mode: "demo", hide: "right", seed: 4, readingDirection: "left-to-right", consent: true },
      outputs(4, "right"),
      { id: "battery-demo-source", now: new Date("2026-11-14T12:00:00.000Z") },
    );
    assert.equal(record.source, "demonstration");
    assert.equal(record.greyscales, null);
    assert.equal(record.bisection, null);
    assert.deepEqual(batteryStepOrder("demo"), ["scene", "clock"]);
    assert.deepEqual(batteryStepOrder("full"), ["scene", "clock", "greyscales", "bisection"]);
    assert.deepEqual(runnableBatterySteps("demo"), ["clock"]);
    assert.deepEqual(runnableBatterySteps("full"), ["clock", "greyscales", "bisection"]);
    assert.deepEqual(runnableBatterySteps("full", true), ["scene", "clock", "greyscales", "bisection"]);
  });

  it("keeps the battery visible when the API client is on", () => {
    assert.equal(batteryEnabled(true), true);
    assert.equal(batteryEnabled(false), true);
  });
});
