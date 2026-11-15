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
import { batchPayload, manifestFor, sampleSession } from "./fixture-session.js";

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
    const summaries = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM derived_summaries WHERE session_id = $1",
      ["battery-full-1"],
    );
    assert.ok(Number(summaries?.count ?? 0) >= 1);
    const processing = await one<{ processing_state: string }>(
      harness.db,
      "SELECT processing_state FROM sessions WHERE id = $1",
      ["battery-full-1"],
    );
    assert.equal(processing?.processing_state, "ready");
  });

  it("saves Starry Night on a completed battery, attaches battery_records, and completes processing", async () => {
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    const uploaded = await uploadSession(harness.app, auth, "battery-roundtrip");
    assert.ok(uploaded.finalized.jobId);
    const pending = await one<{ processing_state: string }>(
      harness.db,
      "SELECT processing_state FROM sessions WHERE id = $1",
      ["battery-roundtrip"],
    );
    assert.equal(pending?.processing_state, "pending");

    const viewed = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/battery-roundtrip",
      headers: authed(auth),
    });
    assert.equal(viewed.statusCode, 200, viewed.body);
    assert.equal((viewed.json() as { processing: string }).processing, "ready");
    const summaries = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM derived_summaries WHERE session_id = $1",
      ["battery-roundtrip"],
    );
    assert.equal(Number(summaries?.count), 1);

    const lines = generateBisectionLines(5, 21);
    const record = parseBatteryRecord({
      ...fullBattery("battery-roundtrip"),
      detection: {
        left: { hits: 6, targets: 8 },
        right: { hits: 8, targets: 8 },
      },
      cancellation: {
        left: { omissions: 2, targets: 12 },
        right: { omissions: 0, targets: 12 },
      },
      bisection: {
        lines,
        responses: lines.map((line) => ({ lineId: line.id, x: (line.x1 + line.x2) / 2 })),
      },
      healthyControl: true,
      consent: true,
      normsUsed: {
        ...fullBattery("battery-roundtrip").normsUsed,
        detection: DEFAULT_NORMS.detection,
        cancellation: DEFAULT_NORMS.cancellation,
      },
    });
    const stored = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/battery-roundtrip/battery",
      headers: authed(auth),
      payload: record,
    });
    assert.equal(stored.statusCode, 200, stored.body);
    const batteryRow = await one<{ record: unknown }>(
      harness.db,
      "SELECT record FROM battery_records WHERE session_id = $1",
      ["battery-roundtrip"],
    );
    assert.ok(batteryRow);
    const persisted = parseBatteryRecord(batteryRow.record);
    assert.equal(persisted.healthyControl, true);
    assert.equal(persisted.consent, true);
    assert.equal(persisted.detection?.left.hits, 6);
    assert.equal(persisted.detection?.left.targets, 8);
    assert.equal(persisted.detection?.right.hits, 8);
    assert.equal(persisted.detection?.right.targets, 8);

    const listed = await harness.app.inject({ method: "GET", url: "/api/v1/sessions", headers: authed(auth) });
    assert.equal(listed.statusCode, 200, listed.body);
    const body = listed.json() as {
      sessions: Array<{ id: string }>;
      batteries: Array<{ id: string; detection?: { left: { hits: number } } }>;
    };
    assert.equal(body.sessions.some((session) => session.id === "battery-roundtrip"), true);
    const listedBattery = body.batteries.find((item) => item.id === "battery-roundtrip");
    assert.ok(listedBattery);
    assert.equal(listedBattery.detection?.left.hits, 6);

    const norms = await harness.app.inject({ method: "GET", url: "/api/v1/norms", headers: authed(auth) });
    assert.equal(norms.statusCode, 200, norms.body);
    assert.equal((norms.json() as { n: number }).n >= 1, true);
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

  it("lets the signed-in participant delete interrupted and pending sessions", async () => {
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    const pendingId = "pending-open";
    const pendingRecord = { ...sampleSession(pendingId), status: "incomplete" as const };
    const admin = await login(harness.app, world.adminA, world.orgA);
    const assignment = await harness.app.inject({
      method: "POST",
      url: "/api/v1/assignments",
      headers: authed(admin),
      payload: { participantId: world.participantId, exposureStatus: "unseen", manifest: manifestFor(pendingRecord) },
    });
    assert.equal(assignment.statusCode, 200, assignment.body);
    const created = assignment.json() as { id: string; revision: number };
    const pendingPut = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/sessions/${pendingId}`,
      headers: authed(auth),
      payload: {
        participantId: world.participantId,
        assignmentId: created.id,
        assignmentRevision: created.revision,
        startedAt: pendingRecord.startedAt,
        completion: "interrupted",
      },
    });
    assert.equal(pendingPut.statusCode, 200, pendingPut.body);
    assert.equal((pendingPut.json() as { processing: string }).processing, "pending");

    const pendingDelete = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/sessions/${pendingId}`,
      headers: authed(auth),
    });
    assert.equal(pendingDelete.statusCode, 200, pendingDelete.body);
    assert.deepEqual(pendingDelete.json(), { sessionId: pendingId, deleted: true, idempotent: false });
    const pendingGone = await harness.app.inject({
      method: "GET",
      url: `/api/v1/sessions/${pendingId}`,
      headers: authed(auth),
    });
    assert.equal(pendingGone.statusCode, 404);

    const sealedId = "interrupted-sealed";
    const sealedRecord = { ...sampleSession(sealedId), status: "incomplete" as const };
    const sealedAssignment = await harness.app.inject({
      method: "POST",
      url: "/api/v1/assignments",
      headers: authed(admin),
      payload: { participantId: world.participantId, exposureStatus: "unseen", manifest: manifestFor(sealedRecord) },
    });
    assert.equal(sealedAssignment.statusCode, 200, sealedAssignment.body);
    const sealedCreated = sealedAssignment.json() as { id: string; revision: number };
    const sealedPut = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/sessions/${sealedId}`,
      headers: authed(auth),
      payload: {
        participantId: world.participantId,
        assignmentId: sealedCreated.id,
        assignmentRevision: sealedCreated.revision,
        startedAt: sealedRecord.startedAt,
        completion: "interrupted",
      },
    });
    assert.equal(sealedPut.statusCode, 200, sealedPut.body);
    const sealedBatch = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/sessions/${sealedId}/batches/batch-1`,
      headers: authed(auth),
      payload: batchPayload(sealedRecord),
    });
    assert.equal(sealedBatch.statusCode, 200, sealedBatch.body);
    const sealedFinal = await harness.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sealedId}/finalize`,
      headers: authed(auth),
    });
    assert.equal(sealedFinal.statusCode, 200, sealedFinal.body);
    const listedBefore = await harness.app.inject({ method: "GET", url: "/api/v1/sessions", headers: authed(auth) });
    assert.equal(
      (listedBefore.json() as { sessions: Array<{ id: string }> }).sessions.some((session) => session.id === sealedId),
      true,
    );

    const sealedDelete = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/sessions/${sealedId}`,
      headers: authed(auth),
    });
    assert.equal(sealedDelete.statusCode, 200, sealedDelete.body);
    const listedAfter = await harness.app.inject({ method: "GET", url: "/api/v1/sessions", headers: authed(auth) });
    assert.equal(
      (listedAfter.json() as { sessions: Array<{ id: string }> }).sessions.some((session) => session.id === sealedId),
      false,
    );

    const repeat = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/sessions/${sealedId}`,
      headers: authed(auth),
    });
    assert.equal(repeat.statusCode, 200, repeat.body);
    assert.equal((repeat.json() as { idempotent: boolean }).idempotent, true);

    const missing = await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/sessions/never-uploaded",
      headers: authed(auth),
    });
    assert.equal(missing.statusCode, 200, missing.body);
    assert.equal((missing.json() as { idempotent: boolean }).idempotent, true);

    await uploadSession(harness.app, auth, "owned-by-a");
    const other = await login(harness.app, world.otherSubject, world.orgA);
    const hidden = await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/sessions/owned-by-a",
      headers: authed(other),
    });
    assert.equal(hidden.statusCode, 404);
  });
});
