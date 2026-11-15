import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_NORMS,
  generateBisectionLines,
  generateClockTrials,
  generateGreyscalesTrials,
  generateScene,
  generateStarryTrials,
  parseBatteryRecord,
  scoreBatteryRecord,
} from "@neurovision/domain";
import { createBatteryStore, memoryStore } from "@neurovision/storage";
import {
  assembleAssessmentBatteryRecord,
  assembleBatteryRecord,
  batteryEnabled,
  batteryStepOrder,
  runnableBatterySteps,
  saveBatterySession,
  shouldPersistBattery,
  type BatteryIntroConfig,
  type BatteryTaskOutputs,
} from "../src/data/batterySession.ts";
import { createAppServices } from "../src/services/index.ts";

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

  it("assembles Starry Night detection from a completed assessment session", async () => {
    const services = createAppServices({
      createId: () => "live-starry",
      now: () => new Date("2026-11-14T16:00:00.000Z"),
    });
    const started = services.startSession({ alias: "Pilot", id: "live-starry", startedAt: "2026-11-14T16:00:00.000Z" });
    const trial = started.trials.find((item) => item.task === "target-selection");
    assert.ok(trial);
    const left = trial.layout.stimuli.filter((stimulus) => stimulus.kind === "target" && stimulus.side === "left").slice(0, 10);
    const right = trial.layout.stimuli.filter((stimulus) => stimulus.kind === "target" && stimulus.side === "right").slice(0, 10);
    let session = started;
    let elapsed = 400;
    for (const stimulus of [...left, ...right]) {
      session = services.recordClick(session, trial.id, { x: stimulus.x, y: stimulus.y }, elapsed);
      elapsed += 500;
    }
    session = services.finishTrial(session, trial.id, "done", 20_000);
    for (const lineTrial of session.trials.filter((item) => item.task === "line-bisection")) {
      assert.ok(lineTrial.line);
      session = services.recordClick(
        session,
        lineTrial.id,
        { x: (lineTrial.line.x1 + lineTrial.line.x2) / 2, y: lineTrial.line.y },
        800,
      );
      session = services.finishTrial(session, lineTrial.id, "done", 1500);
    }
    session = services.completeSession(session, { completedAt: "2026-11-14T16:08:00.000Z" });
    const starryTrials = generateStarryTrials(8, 21);
    const record = assembleAssessmentBatteryRecord(session, {
      trials: starryTrials,
      responses: starryTrials.map((item) => ({ trialId: item.id, rtMs: 400 })),
    });
    assert.equal(record.id, session.id);
    assert.equal(record.healthyControl, true);
    assert.equal(record.consent, true);
    assert.ok(record.detection);
    assert.equal(record.detection.left.hits + record.detection.right.hits, 8);
    assert.ok(record.cancellation);
    assert.ok(record.bisection);
    assert.equal(record.bisection.lines.length, 5);
    const kv = memoryStore();
    const store = createBatteryStore(kv);
    const saved = await saveBatterySession(
      {
        mode: "full",
        hide: "none",
        seed: 21,
        readingDirection: null,
        consent: true,
        healthyControl: true,
      },
      {
        scene: { taps: [] },
        clock: { trials: [], responses: [] },
        bisection: record.bisection ?? undefined,
        detection: record.detection ?? undefined,
        cancellation: record.cancellation ?? undefined,
      },
      { store, id: session.id, startedAt: session.startedAt, completedAt: session.completedAt },
    );
    const loaded = await store.load(session.id);
    assert.ok(loaded);
    assert.equal(loaded.detection?.left.hits, saved.detection?.left.hits);
    assert.equal(loaded.healthyControl, true);
  });
});
