import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BATTERY_CONTRACT_VERSION,
  bisectionObservation,
  combineEvidence,
  generateBisectionLines,
  generateClockTrials,
  generateGreyscalesTrials,
  generateScene,
  greyscalesNormFor,
  parseBatteryRecord,
  scoreBatteryRecord,
  scoreClock,
  scoreGreyscales,
  scoreScene,
  type BatteryRecord,
} from "../src/index.ts";

function makeBattery(overrides: Partial<BatteryRecord> = {}): BatteryRecord {
  const seed = 11;
  const hide = "left" as const;
  const scene = generateScene({ seed, hide });
  const taps = scene.lanterns
    .filter((lantern) => lantern.lit && lantern.x >= scene.visible.x0 && lantern.x < scene.visible.x1)
    .slice(0, 5)
    .map((lantern, index) => ({ t: index * 400, x: lantern.x, y: lantern.y }));
  const clockTrials = generateClockTrials(4, seed);
  const greyTrials = generateGreyscalesTrials(4, seed);
  const lines = generateBisectionLines(4, seed);
  return {
    contract: BATTERY_CONTRACT_VERSION,
    id: "battery-1",
    mode: "full",
    hide,
    seed,
    readingDirection: "left-to-right",
    consent: true,
    source: "live",
    startedAt: "2026-11-14T12:00:00.000Z",
    completedAt: "2026-11-14T12:08:00.000Z",
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
    normsUsed: {},
    ...overrides,
  };
}

describe("parseBatteryRecord", () => {
  it("returns a typed copy of a valid record", () => {
    const original = makeBattery();
    const parsed = parseBatteryRecord(original);
    assert.equal(parsed.contract, BATTERY_CONTRACT_VERSION);
    assert.equal(parsed.id, "battery-1");
    original.id = "mutated";
    original.scene.taps.push({ t: 99, x: 0, y: 0 });
    original.clock.trials[0]!.correct.numerals[0]!.label = "mutated";
    assert.equal(parsed.id, "battery-1");
    assert.equal(parsed.scene.taps.length, original.scene.taps.length - 1);
    assert.notEqual(parsed.clock.trials[0]!.correct.numerals[0]!.label, "mutated");
  });

  it("accepts demo demonstration records with null optional tests", () => {
    const parsed = parseBatteryRecord(
      makeBattery({ mode: "demo", source: "demonstration", greyscales: null, bisection: null, readingDirection: null }),
    );
    assert.equal(parsed.mode, "demo");
    assert.equal(parsed.greyscales, null);
    assert.equal(parsed.bisection, null);
  });

  it("rejects missing fields", () => {
    const keys = [
      "contract",
      "id",
      "mode",
      "hide",
      "seed",
      "readingDirection",
      "consent",
      "source",
      "startedAt",
      "completedAt",
      "scene",
      "clock",
      "greyscales",
      "bisection",
      "normsUsed",
    ] as const;
    for (const key of keys) {
      const value = { ...makeBattery() };
      delete value[key];
      assert.throws(() => parseBatteryRecord(value), /invalid battery record/, `missing ${key}`);
    }
  });

  it("rejects wrong types", () => {
    assert.throws(() => parseBatteryRecord({ ...makeBattery(), id: 1 }), /invalid battery record/);
    assert.throws(() => parseBatteryRecord({ ...makeBattery(), seed: "11" }), /invalid battery record/);
    assert.throws(() => parseBatteryRecord({ ...makeBattery(), consent: "yes" }), /invalid battery record/);
    assert.throws(() => parseBatteryRecord({ ...makeBattery(), hide: "both" }), /invalid battery record/);
    assert.throws(() => parseBatteryRecord({ ...makeBattery(), scene: { taps: null } }), /invalid battery record/);
    assert.throws(() => parseBatteryRecord({ ...makeBattery(), clock: { trials: [], responses: [{ trialId: "x" }] } }), /invalid battery record/);
    assert.throws(() => parseBatteryRecord({ ...makeBattery(), normsUsed: [] }), /invalid battery record/);
    assert.throws(() => parseBatteryRecord({ ...makeBattery(), startedAt: "not-a-date" }), /invalid battery record/);
  });

  it("rejects unknown mode", () => {
    assert.throws(() => parseBatteryRecord({ ...makeBattery(), mode: "practice" }), /invalid battery record/);
    assert.throws(() => parseBatteryRecord({ ...makeBattery(), mode: "assessment" }), /invalid battery record/);
  });

  it("rejects demo mode with live source", () => {
    assert.throws(() => parseBatteryRecord(makeBattery({ mode: "demo", source: "live" })), /invalid battery record/);
  });
});

describe("scoreBatteryRecord", () => {
  it("recomputes the same scores as the individual scorers and combineEvidence", () => {
    const record = parseBatteryRecord(makeBattery());
    const scored = scoreBatteryRecord(record);
    const scene = generateScene({ seed: record.seed, hide: record.hide });
    const sceneScore = scoreScene(scene, record.scene.taps);
    const clockScore = scoreClock(record.clock.trials, record.clock.responses);
    const greyscalesScore = scoreGreyscales(record.greyscales!.trials, record.greyscales!.responses);
    const bisectionScore = bisectionObservation(record.bisection!.lines, record.bisection!.responses);
    const observations = [
      sceneScore.observationVisible,
      ...(sceneScore.observationInduced ? [sceneScore.observationInduced] : []),
      clockScore.observation,
      greyscalesScore.observation,
      bisectionScore.observation,
    ];
    assert.deepEqual(scored.scene, sceneScore);
    assert.deepEqual(scored.clock, clockScore);
    assert.deepEqual(scored.greyscales, greyscalesScore);
    assert.deepEqual(scored.bisection, bisectionScore);
    assert.deepEqual(scored.evidence, combineEvidence(observations, { greyscales: greyscalesNormFor("left-to-right") }));
  });

  it("is stable across parse of a JSON copy", () => {
    const record = parseBatteryRecord(makeBattery());
    const first = scoreBatteryRecord(record);
    const second = scoreBatteryRecord(parseBatteryRecord(JSON.parse(JSON.stringify(record))));
    assert.deepEqual(second, first);
  });
});
