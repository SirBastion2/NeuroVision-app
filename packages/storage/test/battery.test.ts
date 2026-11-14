import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BATTERY_CONTRACT_VERSION,
  generateBisectionLines,
  generateClockTrials,
  generateGreyscalesTrials,
  generateScene,
  parseBatteryRecord,
  scoreBatteryRecord,
  type BatteryRecord,
} from "@neurovision/domain";
import {
  BATTERY_KEY,
  ENVELOPE_KEY,
  createBatteryStore,
  memoryStore,
  saveBatteryRecord,
} from "../src/index.js";

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

describe("battery store", () => {
  it("save → load → parse → rescore yields identical scores", async () => {
    const kv = memoryStore();
    const store = createBatteryStore(kv);
    const record = parseBatteryRecord(makeBattery());
    const before = scoreBatteryRecord(record);
    await store.save(record);
    assert.ok(kv.snapshot()[BATTERY_KEY]);
    assert.equal(kv.snapshot()[ENVELOPE_KEY], undefined);
    const loaded = await store.load(record.id);
    assert.ok(loaded);
    const parsed = parseBatteryRecord(loaded);
    const after = scoreBatteryRecord(parsed);
    assert.deepEqual(after, before);
    assert.equal((await store.list()).length, 1);
  });

  it("upserts by id on the battery key and leaves the session envelope untouched", () => {
    const kv = memoryStore();
    const first = makeBattery({ id: "battery-1" });
    saveBatteryRecord(kv, first);
    saveBatteryRecord(kv, makeBattery({ id: "battery-1", seed: 12 }));
    saveBatteryRecord(kv, makeBattery({ id: "battery-2", source: "demonstration", mode: "demo", greyscales: null, bisection: null }));
    const stored = JSON.parse(kv.snapshot()[BATTERY_KEY] ?? "{}") as { records: BatteryRecord[] };
    assert.equal(stored.records.length, 2);
    assert.equal(stored.records.find((item) => item.id === "battery-1")?.seed, 12);
    assert.equal(kv.snapshot()[ENVELOPE_KEY], undefined);
  });
});
