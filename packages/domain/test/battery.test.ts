import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSUMED_NORM_NOTICE,
  BATTERY_CONTRACT_VERSION,
  DEFAULT_NORMS,
  bisectionObservation,
  combineEvidence,
  fittedNormNotice,
  generateBisectionLines,
  generateClockTrials,
  generateGreyscalesTrials,
  generateScene,
  greyscalesNormFor,
  isHealthyControlSample,
  modelIndicesFromBattery,
  parseBatteryRecord,
  scoreBatteryRecord,
  scoreClock,
  scoreGreyscales,
  scoreScene,
  scoringNormsFromBatteries,
  signedErrorPct,
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
    detection: null,
    cancellation: null,
    healthyControl: false,
    fixture: false,
    normsUsed: {},
    ...overrides,
  };
}

function fiveLines(seed: number) {
  return generateBisectionLines(5, seed).slice(0, 5);
}

function markAtError(line: { x1: number; x2: number }, errorPct: number): number {
  const mid = (line.x1 + line.x2) / 2;
  return mid + (errorPct / 100) * (line.x2 - line.x1);
}

function healthyBattery(
  id: string,
  sample: { detection: { leftHits: number; rightHits: number }; cancellation: { leftOm: number; rightOm: number }; errorPct: number },
): BatteryRecord {
  const lines = fiveLines(21);
  return parseBatteryRecord(
    makeBattery({
      id,
      hide: "none",
      healthyControl: true,
      fixture: true,
      consent: true,
      detection: {
        left: { hits: sample.detection.leftHits, targets: 8 },
        right: { hits: sample.detection.rightHits, targets: 8 },
      },
      cancellation: {
        left: { omissions: sample.cancellation.leftOm, targets: 8 },
        right: { omissions: sample.cancellation.rightOm, targets: 8 },
      },
      bisection: {
        lines,
        responses: lines.map((line) => ({ lineId: line.id, x: markAtError(line, sample.errorPct) })),
      },
    }),
  );
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
    assert.equal(scored.detection, null);
    assert.equal(scored.cancellation, null);
    assert.deepEqual(scored.evidence, combineEvidence(observations, { greyscales: greyscalesNormFor("left-to-right") }));
  });

  it("defaults missing detection, cancellation, and healthy-control flags", () => {
    const value = { ...makeBattery() } as Record<string, unknown>;
    delete value.detection;
    delete value.cancellation;
    delete value.healthyControl;
    delete value.fixture;
    const parsed = parseBatteryRecord(value);
    assert.equal(parsed.detection, null);
    assert.equal(parsed.cancellation, null);
    assert.equal(parsed.healthyControl, false);
    assert.equal(parsed.fixture, false);
    assert.equal(isHealthyControlSample(parsed), false);
  });

  it("stores Eq. (1) counts and the five signed bisection errors", () => {
    const record = healthyBattery("healthy-1", {
      detection: { leftHits: 7, rightHits: 8 },
      cancellation: { leftOm: 1, rightOm: 0 },
      errorPct: -1,
    });
    const indices = modelIndicesFromBattery(record);
    assert.ok(indices);
    assert.equal(indices.detection, 7 / 8 - 8 / 8);
    assert.equal(indices.cancellation, 0 / 8 - 1 / 8);
    assert.equal(record.bisection?.responses.length, 5);
    const errors = record.bisection!.lines.map((line, index) => signedErrorPct(line, record.bisection!.responses[index]!.x!));
    assert.equal(errors.length, 5);
    assert.ok(errors.every((error) => Math.abs(error - -1) < 1e-12));
    assert.ok(Math.abs(indices.bisection - 1) < 1e-12);
    const scored = scoreBatteryRecord(record);
    assert.equal(scored.detection?.test, "detection");
    assert.equal(scored.cancellation?.test, "cancellation");
    assert.equal(scored.detection?.value, indices.detection);
    assert.equal(scored.cancellation?.value, indices.cancellation);
  });

  it("keeps Table 2 placeholders below five healthy-control samples and fits Eq. (9) at n = 8", () => {
    const specs = [
      { detection: { leftHits: 8, rightHits: 8 }, cancellation: { leftOm: 0, rightOm: 0 }, errorPct: -1 },
      { detection: { leftHits: 8, rightHits: 7 }, cancellation: { leftOm: 0, rightOm: 1 }, errorPct: -1.2 },
      { detection: { leftHits: 7, rightHits: 8 }, cancellation: { leftOm: 1, rightOm: 0 }, errorPct: -0.8 },
      { detection: { leftHits: 8, rightHits: 6 }, cancellation: { leftOm: 0, rightOm: 2 }, errorPct: -1.1 },
      { detection: { leftHits: 6, rightHits: 8 }, cancellation: { leftOm: 2, rightOm: 0 }, errorPct: -0.9 },
      { detection: { leftHits: 8, rightHits: 8 }, cancellation: { leftOm: 0, rightOm: 0 }, errorPct: -1 },
      { detection: { leftHits: 8, rightHits: 7 }, cancellation: { leftOm: 0, rightOm: 1 }, errorPct: -1.3 },
      { detection: { leftHits: 7, rightHits: 8 }, cancellation: { leftOm: 1, rightOm: 0 }, errorPct: -0.7 },
    ];
    const records = specs.map((spec, index) => healthyBattery(`healthy-${index + 1}`, spec));
    const four = scoringNormsFromBatteries(records.slice(0, 4));
    assert.equal(four.n, 4);
    assert.equal(four.source, "assumed");
    assert.equal(four.norms.detection.source, "assumed");
    assert.equal(four.norms.detection.mean, DEFAULT_NORMS.detection.mean);
    assert.equal(four.norms.detection.healthySd, DEFAULT_NORMS.detection.healthySd);
    const scoredFour = scoreBatteryRecord({ ...records[0]!, normsUsed: four.norms });
    assert.equal(scoredFour.evidence.usesAssumedNorms, true);
    assert.equal(scoredFour.evidence.usesFittedNorms, false);
    assert.ok(scoredFour.evidence.notes.includes(ASSUMED_NORM_NOTICE));

    const eight = scoringNormsFromBatteries(records);
    assert.equal(eight.n, 8);
    assert.equal(eight.source, "fitted");
    const detectionValues = records.map((record) => modelIndicesFromBattery(record)!.detection);
    const n = detectionValues.length;
    const mean = detectionValues.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(detectionValues.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
    const expectedMean = (n * mean + 8 * 0) / (n + 8);
    const expectedSd = Math.sqrt(((n - 1) * sd * sd + 8 * 0.15 ** 2) / (n - 1 + 8));
    assert.ok(Math.abs(eight.norms.detection.mean! - expectedMean) < 1e-12);
    assert.ok(Math.abs(eight.norms.detection.healthySd! - expectedSd) < 1e-12);
    assert.equal(eight.norms.detection.source, "fitted");
    assert.equal(eight.norms.detection.sample?.n, 8);
    const scoredEight = scoreBatteryRecord({ ...records[0]!, normsUsed: eight.norms });
    assert.equal(scoredEight.evidence.usesAssumedNorms, false);
    assert.equal(scoredEight.evidence.usesFittedNorms, true);
    assert.ok(scoredEight.evidence.notes.includes(fittedNormNotice(8)));
    assert.doesNotMatch(scoredEight.evidence.notes.join(" "), /prototype/i);
  });

  it("is stable across parse of a JSON copy", () => {
    const record = parseBatteryRecord(makeBattery());
    const first = scoreBatteryRecord(record);
    const second = scoreBatteryRecord(parseBatteryRecord(JSON.parse(JSON.stringify(record))));
    assert.deepEqual(second, first);
  });
});
