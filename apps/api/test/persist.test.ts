import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  DEFAULT_NORMS,
  generateBisectionLines,
  generateClockTrials,
  generateGreyscalesTrials,
  generateScene,
  parseBatteryRecord,
  type BatteryRecord,
} from "@neurovision/domain";
import { migrate, one } from "../src/db.js";
import { shouldPersistBattery } from "../src/sessions.js";
import { authed, createHarness, login, seed, uploadSession, world } from "./harness.js";

function fullBattery(id: string): BatteryRecord {
  const seedValue = 21;
  const scene = generateScene({ seed: seedValue, hide: "none" });
  const clockTrials = generateClockTrials(4, seedValue);
  const greyTrials = generateGreyscalesTrials(4, seedValue);
  const lines = generateBisectionLines(4, seedValue);
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
      responses: lines.map((line) => ({ lineId: line.id, x: (line.x1 + line.x2) / 2 })),
    },
    normsUsed: {
      scene: DEFAULT_NORMS.scene,
      clock: DEFAULT_NORMS.clock,
      greyscales: DEFAULT_NORMS.greyscales,
      bisection: DEFAULT_NORMS.bisection,
    },
  });
}

describe("session persistence", { concurrency: false }, () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  before(async () => {
    harness = await createHarness();
    await seed(harness.db);
  });

  after(async () => {
    await harness.close();
  });

  it("migrates on PGlite without TimescaleDB", async () => {
    await migrate(harness.db);
    const events = await one<{ ok: number }>(harness.db, "SELECT 1 AS ok FROM response_events LIMIT 1");
    assert.equal(events, null);
  });

  it("lists sealed sessions and a date_trunc activity bucket", async () => {
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    await uploadSession(harness.app, auth, "hist-session");
    const listed = await harness.app.inject({ method: "GET", url: "/api/v1/sessions", headers: authed(auth) });
    assert.equal(listed.statusCode, 200, listed.body);
    const body = listed.json() as { sessions: Array<{ id: string }>; activity: Array<{ bucket: string; count: number }> };
    assert.equal(body.sessions.some((session) => session.id === "hist-session"), true);
    assert.ok(body.activity.length >= 1);
    assert.ok(body.activity[0]?.bucket);
    assert.ok(body.activity[0]!.count >= 1);
  });

  it("stores a full battery as sessions, trials, and response_events", async () => {
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    const record = fullBattery("battery-full-1");
    assert.equal(shouldPersistBattery(record), true);
    const stored = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/battery-full-1/battery",
      headers: authed(auth),
      payload: record,
    });
    assert.equal(stored.statusCode, 200, stored.body);
    const events = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM response_events WHERE session_id = $1",
      ["battery-full-1"],
    );
    assert.ok(Number(events?.count ?? 0) > 0);
    const trials = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM trials WHERE session_id = $1",
      ["battery-full-1"],
    );
    assert.ok(Number(trials?.count ?? 0) >= 3);
    const listed = await harness.app.inject({ method: "GET", url: "/api/v1/sessions", headers: authed(auth) });
    const body = listed.json() as { batteries: Array<{ id: string }> };
    assert.equal(body.batteries.some((item) => item.id === "battery-full-1"), true);
  });

  it("refuses to store the hidden-scene demo", async () => {
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    const demo = {
      ...fullBattery("battery-demo-1"),
      id: "battery-demo-1",
      mode: "demo",
      hide: "left",
      source: "demonstration",
      greyscales: null,
      bisection: null,
    };
    assert.equal(shouldPersistBattery(parseBatteryRecord(demo)), false);
    const stored = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/battery-demo-1/battery",
      headers: authed(auth),
      payload: demo,
    });
    assert.equal(stored.statusCode, 400);
  });
});
