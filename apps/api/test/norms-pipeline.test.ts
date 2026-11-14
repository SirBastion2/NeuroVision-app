import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  ASSUMED_NORM_NOTICE,
  DEFAULT_NORMS,
  fittedNormNotice,
  generateBisectionLines,
  generateClockTrials,
  generateGreyscalesTrials,
  generateScene,
  parseBatteryRecord,
  seProportionDiff,
  signedErrorPct,
  standardize,
  type BatteryRecord,
  type TestNorm,
} from "@neurovision/domain";
import { asJson, one } from "../src/db.js";
import { authed, createHarness, login, seed, world } from "./harness.js";

const SPECS = [
  { leftHits: 8, rightHits: 8, leftOm: 0, rightOm: 0, errorPct: -1 },
  { leftHits: 8, rightHits: 7, leftOm: 0, rightOm: 1, errorPct: -1.2 },
  { leftHits: 7, rightHits: 8, leftOm: 1, rightOm: 0, errorPct: -0.8 },
  { leftHits: 8, rightHits: 6, leftOm: 0, rightOm: 2, errorPct: -1.1 },
  { leftHits: 6, rightHits: 8, leftOm: 2, rightOm: 0, errorPct: -0.9 },
  { leftHits: 8, rightHits: 8, leftOm: 0, rightOm: 0, errorPct: -1 },
  { leftHits: 8, rightHits: 7, leftOm: 0, rightOm: 1, errorPct: -1.3 },
  { leftHits: 7, rightHits: 8, leftOm: 1, rightOm: 0, errorPct: -0.7 },
] as const;

function markAtError(line: { x1: number; x2: number }, errorPct: number): number {
  const mid = (line.x1 + line.x2) / 2;
  return mid + (errorPct / 100) * (line.x2 - line.x1);
}

function eq9(values: number[], priorMean: number, priorSd: number, kappa = 8): { mean: number; sd: number } {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return {
    mean: (n * mean + kappa * priorMean) / (n + kappa),
    sd: Math.sqrt(((n - 1) * sd * sd + kappa * priorSd ** 2) / (n - 1 + kappa)),
  };
}

function detectionValue(leftHits: number, rightHits: number): number {
  return leftHits / 8 - rightHits / 8;
}

function cancellationValue(leftOm: number, rightOm: number): number {
  return rightOm / 8 - leftOm / 8;
}

interface CountSpec {
  leftHits: number;
  rightHits: number;
  leftOm: number;
  rightOm: number;
  errorPct: number;
}

function fixtureBattery(id: string, spec: CountSpec, healthyControl: boolean): BatteryRecord {
  const seedValue = 21;
  const scene = generateScene({ seed: seedValue, hide: "none" });
  const clockTrials = generateClockTrials(4, seedValue);
  const greyTrials = generateGreyscalesTrials(4, seedValue);
  const lines = generateBisectionLines(5, seedValue);
  return parseBatteryRecord({
    contract: "battery-1.0.0",
    id,
    mode: "full",
    hide: "none",
    seed: seedValue,
    readingDirection: "left-to-right",
    consent: true,
    source: "live",
    startedAt: "2026-11-14T16:00:00.000Z",
    completedAt: "2026-11-14T16:08:00.000Z",
    scene: {
      taps: scene.lanterns
        .filter((lantern) => lantern.lit)
        .slice(0, 4)
        .map((lantern, index) => ({ t: index * 400, x: lantern.x, y: lantern.y })),
    },
    clock: {
      trials: clockTrials,
      responses: clockTrials.map((trial) => ({ trialId: trial.id, choice: trial.correctPosition, rtMs: 700 })),
    },
    greyscales: {
      trials: greyTrials,
      responses: greyTrials.map((trial) => ({ trialId: trial.id, choice: "top" as const, rtMs: 500 })),
    },
    bisection: {
      lines,
      responses: lines.map((line) => ({ lineId: line.id, x: markAtError(line, spec.errorPct) })),
    },
    detection: {
      left: { hits: spec.leftHits, targets: 8 },
      right: { hits: spec.rightHits, targets: 8 },
    },
    cancellation: {
      left: { omissions: spec.leftOm, targets: 8 },
      right: { omissions: spec.rightOm, targets: 8 },
    },
    healthyControl,
    fixture: true,
    normsUsed: {
      bisection: DEFAULT_NORMS.bisection,
      detection: DEFAULT_NORMS.detection,
      cancellation: DEFAULT_NORMS.cancellation,
    },
  });
}

describe("healthy-control norms pipeline", { concurrency: false }, () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;
  let auth: { cookie: string; csrf: string };

  before(async () => {
    harness = await createHarness();
    await seed(harness.db);
    auth = await login(harness.app, world.participantSubject, world.orgA);
  });

  after(async () => {
    await harness.close();
  });

  async function putBattery(record: BatteryRecord) {
    const stored = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/sessions/${record.id}/battery`,
      headers: authed(auth),
      payload: record,
    });
    assert.equal(stored.statusCode, 200, stored.body);
    return stored;
  }

  async function getNorms() {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/norms",
      headers: authed(auth),
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as {
      n: number;
      source: "assumed" | "fitted";
      notice: string;
      norms: { detection: TestNorm; cancellation: TestNorm; bisection: TestNorm };
    };
  }

  it("stores Eq. (1) counts and five signed errors, keeps Table 2 until n ≥ 5, then fits Eq. (9)", async () => {
    for (let index = 0; index < 4; index += 1) {
      await putBattery(fixtureBattery(`fixture-healthy-${index + 1}`, SPECS[index]!, true));
    }

    const stored = await one<{ record: unknown }>(harness.db, "SELECT record FROM battery_records WHERE session_id = $1", [
      "fixture-healthy-1",
    ]);
    const persisted = parseBatteryRecord(stored ? asJson(stored.record) : null);
    assert.equal(persisted.healthyControl, true);
    assert.equal(persisted.fixture, true);
    assert.equal(persisted.detection?.left.hits, 8);
    assert.equal(persisted.detection?.left.targets, 8);
    assert.equal(persisted.detection?.right.hits, 8);
    assert.equal(persisted.detection?.right.targets, 8);
    assert.equal(persisted.cancellation?.left.omissions, 0);
    assert.equal(persisted.cancellation?.right.omissions, 0);
    assert.equal(persisted.bisection?.responses.length, 5);
    const errors = persisted.bisection!.lines.map((line, index) =>
      signedErrorPct(line, persisted.bisection!.responses[index]!.x!),
    );
    assert.equal(errors.length, 5);
    assert.ok(errors.every((error) => Math.abs(error - -1) < 1e-12));

    const detectionTrial = await one<{ payload: unknown }>(
      harness.db,
      "SELECT payload FROM trials WHERE session_id = $1 AND trial_id = $2",
      ["fixture-healthy-1", "fixture-healthy-1-detection"],
    );
    const detectionPayload = asJson<{ left: { hits: number; targets: number }; right: { hits: number; targets: number } }>(
      detectionTrial?.payload,
    );
    assert.equal(detectionPayload.left.hits / detectionPayload.left.targets - detectionPayload.right.hits / detectionPayload.right.targets, 0);

    const four = await getNorms();
    assert.equal(four.n, 4);
    assert.equal(four.source, "assumed");
    assert.equal(four.notice, ASSUMED_NORM_NOTICE);
    assert.equal(four.norms.detection.mean, 0);
    assert.equal(four.norms.detection.healthySd, 0.15);
    assert.equal(four.norms.cancellation.mean, 0);
    assert.equal(four.norms.cancellation.healthySd, 0.06);
    assert.equal(four.norms.bisection.mean, 1);
    assert.equal(four.norms.bisection.healthySd, 3);
    assert.equal(four.norms.detection.source, "assumed");

    for (let index = 4; index < 8; index += 1) {
      await putBattery(fixtureBattery(`fixture-healthy-${index + 1}`, SPECS[index]!, true));
    }

    const eight = await getNorms();
    assert.equal(eight.n, 8);
    assert.equal(eight.source, "fitted");
    assert.equal(eight.notice, fittedNormNotice(8));
    const detectionValues = SPECS.map((spec) => detectionValue(spec.leftHits, spec.rightHits));
    const cancellationValues = SPECS.map((spec) => cancellationValue(spec.leftOm, spec.rightOm));
    const bisectionValues = SPECS.map((spec) => -spec.errorPct);
    const detectionFit = eq9(detectionValues, 0, 0.15);
    const cancellationFit = eq9(cancellationValues, 0, 0.06);
    const bisectionFit = eq9(bisectionValues, 1, 3);
    assert.ok(Math.abs(eight.norms.detection.mean! - detectionFit.mean) < 1e-12);
    assert.ok(Math.abs(eight.norms.detection.healthySd! - detectionFit.sd) < 1e-12);
    assert.ok(Math.abs(eight.norms.cancellation.mean! - cancellationFit.mean) < 1e-12);
    assert.ok(Math.abs(eight.norms.cancellation.healthySd! - cancellationFit.sd) < 1e-12);
    assert.ok(Math.abs(eight.norms.bisection.mean! - bisectionFit.mean) < 1e-12);
    assert.ok(Math.abs(eight.norms.bisection.healthySd! - bisectionFit.sd) < 1e-12);
    assert.equal(eight.norms.detection.source, "fitted");
    assert.equal(eight.norms.detection.sample?.n, 8);
    assert.equal(eight.norms.cancellation.source, "fitted");
    assert.equal(eight.norms.bisection.source, "fitted");

    const probeSpec = { leftHits: 6, rightHits: 8, leftOm: 2, rightOm: 0, errorPct: 2 } as const;
    await putBattery(fixtureBattery("fixture-probe", probeSpec, false));
    const viewed = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/fixture-probe",
      headers: authed(auth),
    });
    assert.equal(viewed.statusCode, 200, viewed.body);
    const body = viewed.json() as {
      battery: BatteryRecord;
      score: {
        evidence: {
          usesAssumedNorms: boolean;
          usesFittedNorms: boolean;
          notes: string[];
          tests: Array<{ test: string; z: number }>;
        };
        detection: { value: number; se: number };
      };
    };
    assert.equal(body.battery.healthyControl, false);
    assert.equal(body.battery.fixture, true);
    assert.equal(body.score.evidence.usesAssumedNorms, false);
    assert.equal(body.score.evidence.usesFittedNorms, true);
    assert.ok(body.score.evidence.notes.includes(fittedNormNotice(8)));
    const detectionRow = body.score.evidence.tests.find((row) => row.test === "detection");
    const expectedZ = standardize(
      {
        test: "detection",
        label: "Starry Night",
        value: detectionValue(probeSpec.leftHits, probeSpec.rightHits),
        se: seProportionDiff(probeSpec.leftHits, 8, probeSpec.rightHits, 8),
        n: 16,
      },
      eight.norms.detection,
    );
    assert.ok(detectionRow);
    assert.ok(Math.abs(detectionRow.z - expectedZ) < 1e-12);
    assert.notEqual(detectionRow.z, (detectionValue(probeSpec.leftHits, probeSpec.rightHits) - 0) / Math.sqrt(0.15 ** 2 + seProportionDiff(6, 8, 8, 8) ** 2));
  });
});
