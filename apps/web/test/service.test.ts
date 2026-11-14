import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONTRACTS_VERSION,
  PROTOCOL_ID,
  SCORER_ID,
  parseSessionRecord,
} from "@neurovision/domain";
import { assembleBatteryRecord } from "../src/data/batterySession.ts";
import {
  createApiClient,
  createAppServices,
  createMemoryKeyValueStore,
  createMemoryStore,
  createUploadQueue,
  type PackageStoreFactory,
} from "../src/services/index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function targetTrial(session: ReturnType<ReturnType<typeof createAppServices>["startSession"]>) {
  const trial = session.trials.find((item) => item.task === "target-selection");
  assert.ok(trial);
  return trial;
}

function fillHits(
  services: ReturnType<typeof createAppServices>,
  session: ReturnType<ReturnType<typeof createAppServices>["startSession"]>,
  leftHits: number,
  rightHits: number,
) {
  const trial = targetTrial(session);
  const left = trial.layout.stimuli
    .filter((stimulus) => stimulus.kind === "target" && stimulus.side === "left")
    .slice(0, leftHits);
  const right = trial.layout.stimuli
    .filter((stimulus) => stimulus.kind === "target" && stimulus.side === "right")
    .slice(0, rightHits);
  let next = session;
  let elapsed = 800;
  for (const stimulus of [...left, ...right]) {
    next = services.recordClick(next, trial.id, { x: stimulus.x, y: stimulus.y }, elapsed);
    elapsed += 650;
  }
  next = services.finishTrial(next, trial.id, "done", 22_000);
  for (const lineTrial of next.trials.filter((item) => item.task === "line-bisection")) {
    assert.ok(lineTrial.line);
    const x = (lineTrial.line.x1 + lineTrial.line.x2) / 2;
    next = services.recordClick(next, lineTrial.id, { x, y: lineTrial.line.y }, 1000);
    next = services.finishTrial(next, lineTrial.id, "done", 2000);
  }
  return services.completeSession(next, { completedAt: "2026-11-14T16:02:00.000Z" });
}

describe("app service layer", () => {
  it("starts a live assessment session with protocol layouts", () => {
    const services = createAppServices({
      createId: () => "session-1",
      now: () => new Date("2026-11-14T16:00:00.000Z"),
    });
    const session = services.startSession({ alias: "Pilot" });
    assert.equal(session.id, "session-1");
    assert.equal(session.source, "live");
    assert.equal(session.status, "incomplete");
    assert.equal(session.protocol, PROTOCOL_ID);
    assert.equal(session.scorer, SCORER_ID);
    assert.equal(session.alias, "Pilot");
    assert.equal(session.trials.length, 6);
    assert.equal(session.input, "mouse-trackpad");
    assert.equal(targetTrial(session).layout.id, "fixed-a");
    assert.equal(
      session.trials.filter((trial) => trial.task === "line-bisection").length,
      5,
    );
    assert.equal(parseSessionRecord(session).id, session.id);
    assert.equal(services.contractsVersion, CONTRACTS_VERSION);
  });

  it("scores, saves, and reloads a completed session through the memory store", async () => {
    const store = createMemoryStore();
    const services = createAppServices({
      store,
      createId: () => "live-balanced",
      now: () => new Date("2026-11-14T16:00:00.000Z"),
    });
    assert.equal(services.storeKind, "memory");
    const started = services.startSession({ alias: "Live balanced" });
    const completed = fillHits(services, started, 10, 10);
    const scored = services.score(completed);
    assert.equal(scored.spatialPattern.kind, "balanced");
    assert.equal(scored.practice.cue, "none");
    const saved = await services.save(completed);
    const reloaded = await services.load(saved.id);
    assert.ok(reloaded);
    assert.deepEqual(reloaded, saved);
    assert.equal(reloaded.status, "complete");
    assert.equal(services.score(reloaded).spatialPattern.kind, "balanced");
  });

  it("lists comparable live history and excludes demonstration records from the trend", async () => {
    const services = createAppServices({
      now: () => new Date("2026-11-14T16:00:00.000Z"),
    });
    const first = fillHits(
      services,
      services.startSession({ id: "live-a", alias: "A", startedAt: "2026-11-14T16:00:00.000Z" }),
      10,
      10,
    );
    const second = fillHits(
      services,
      services.startSession({ id: "live-b", alias: "B", startedAt: "2026-11-14T16:05:00.000Z" }),
      6,
      12,
    );
    const demo = {
      ...first,
      id: "demo-fixture",
      source: "demonstration" as const,
      alias: "Demo fixture",
    };
    await services.save(first);
    await services.save(second);
    await services.save(demo);
    const history = await services.comparableHistory();
    assert.equal(history.sessions.length, 3);
    assert.equal(services.sessionsComparable(first, second), true);
    assert.deepEqual(
      history.trend.points.map((point) => point.sessionId),
      ["live-a", "live-b"],
    );
    assert.equal(
      history.trend.excluded.filter((item) => item.reason === "demonstration").length,
      1,
    );
  });

  it("loads gaze-lab fixture data", () => {
    const services = createAppServices();
    const gaze = services.loadGazeLabData();
    assert.equal(gaze.streams.length, 2);
    assert.ok(gaze.clicks.length >= 16);
    assert.equal(gaze.calibration.pointCount, 9);
    assert.equal(gaze.fixture.streams, gaze.streams);
    assert.ok(gaze.analysisVersion.length > 0);
    assert.ok(gaze.simulated.leftBiased.samples.length > 0);
    assert.ok(gaze.simulated.bothHalves.samples.length > 0);
    assert.notEqual(gaze.simulated.leftBiased.id, gaze.simulated.bothHalves.id);
  });

  it("falls back to in-memory history when no key-value backend is available", () => {
    const services = createAppServices();
    assert.equal(existsSync(join(repoRoot, "packages/storage")), true);
    assert.equal(services.storeKind, "memory");
    assert.equal(services.apiEnabled, false);
  });

  it("uses the storage-package HistoryStore when a key-value backend is present", async () => {
    const kv = createMemoryKeyValueStore();
    const services = createAppServices({
      keyValueStore: kv,
      config: { apiBaseUrl: "", standalone: false },
    });
    assert.equal(services.storeKind, "package");
    const started = services.startSession({
      id: "pkg-real",
      alias: "Package default",
      startedAt: "2026-11-14T16:00:00.000Z",
    });
    const saved = await services.save(started);
    const reloaded = await services.load(saved.id);
    assert.ok(reloaded);
    assert.equal(reloaded.id, saved.id);
    assert.equal(reloaded.alias, saved.alias);
    await services.remove(saved.id);
    assert.equal(await services.load(saved.id), null);
  });

  it("uses the storage-package HistoryStore as the default when that factory is present", async () => {
    const inner = createMemoryStore();
    const factory: PackageStoreFactory = () => ({
      kind: "package",
      save: (record) => inner.save(record),
      load: (id) => inner.load(id),
      list: () => inner.list(),
      remove: (id) => inner.remove(id),
    });
    const kv = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const services = createAppServices({
      packageStoreFactory: factory,
      keyValueStore: kv,
    });
    assert.equal(services.storeKind, "package");
    const started = services.startSession({
      id: "pkg-1",
      alias: "Package default",
      startedAt: "2026-11-14T16:00:00.000Z",
    });
    const saved = await services.save(started);
    const reloaded = await services.load(saved.id);
    assert.deepEqual(reloaded, saved);
  });

  it("keeps in-memory history for the standalone build even when a package factory is present", () => {
    const inner = createMemoryStore();
    const factory: PackageStoreFactory = () => ({
      kind: "package",
      save: (record) => inner.save(record),
      load: (id) => inner.load(id),
      list: () => inner.list(),
      remove: (id) => inner.remove(id),
    });
    const services = createAppServices({
      standalone: true,
      packageStoreFactory: factory,
      keyValueStore: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
    assert.equal(services.storeKind, "memory");
    assert.equal(services.apiEnabled, false);
  });

  it("reads history and batteries from the API when configured, with local fallback", async () => {
    const kv = createMemoryKeyValueStore();
    const localServices = createAppServices({ keyValueStore: kv });
    const local = localServices.startSession({
      id: "local-1",
      alias: "Local",
      startedAt: "2026-11-14T17:00:00.000Z",
    });
    await localServices.save(local);
    const remote = localServices.startSession({
      id: "remote-1",
      alias: "Remote",
      startedAt: "2026-11-14T18:00:00.000Z",
    });
    const battery = assembleBatteryRecord(
      { mode: "full", hide: "none", seed: 7, readingDirection: "left-to-right", consent: true },
      {
        scene: { taps: [] },
        clock: { trials: [], responses: [] },
        greyscales: { trials: [], responses: [] },
        bisection: { lines: [], responses: [] },
      },
      { id: "bat-1", startedAt: "2026-11-14T18:00:00.000Z", completedAt: "2026-11-14T18:08:00.000Z" },
    );
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/sessions") && !url.includes("/sessions/remote") && !url.includes("/battery")) {
        return new Response(
          JSON.stringify({
            sessions: [remote],
            batteries: [battery],
            activity: [{ bucket: "2026-11-14T00:00:00.000Z", count: 3 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    };
    const services = createAppServices({
      keyValueStore: kv,
      config: { apiBaseUrl: "https://api.example.test", standalone: false },
      fetch: fetchImpl,
    });
    const history = await services.listHistory();
    assert.equal(history.some((row) => row.id === "local-1"), true);
    assert.equal(history.some((row) => row.id === "remote-1"), true);
    const batteries = await services.listBatteries();
    assert.equal(batteries.some((row) => row.id === "bat-1"), true);
    const activity = await services.sessionActivity();
    assert.equal(activity[0]?.count, 3);
  });

  it("deletes an incomplete pending session locally, from the upload queue, and on the server", async () => {
    const kv = createMemoryKeyValueStore();
    const deleted: string[] = [];
    let remoteSessions: unknown[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "DELETE" && /\/api\/v1\/sessions\/([^/?]+)$/.test(url)) {
        const sessionId = decodeURIComponent(url.split("/sessions/")[1] ?? "");
        deleted.push(sessionId);
        const existed = remoteSessions.some((row) => (row as { id?: string }).id === sessionId);
        remoteSessions = remoteSessions.filter((row) => (row as { id?: string }).id !== sessionId);
        if (!existed) {
          return new Response(JSON.stringify({ error: "not_found", message: "Not found." }), { status: 404 });
        }
        return new Response(JSON.stringify({ sessionId, deleted: true, idempotent: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url.includes("/api/v1/sessions") && !url.includes("/sessions/pending-open")) {
        return new Response(JSON.stringify({ sessions: remoteSessions, batteries: [], activity: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unavailable", message: "offline" }), { status: 503 });
    };
    const api = createApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
    });
    const queue = createUploadQueue({
      api,
      store: kv,
      isOnline: () => false,
      listenOnline: () => () => undefined,
    });
    const services = createAppServices({
      keyValueStore: kv,
      api,
      queue,
      config: { apiBaseUrl: "https://api.example.test", standalone: false },
      fetch: fetchImpl,
      now: () => new Date("2026-11-14T16:00:00.000Z"),
    });
    const kept = fillHits(
      services,
      services.startSession({
        id: "kept-1",
        alias: "Kept",
        profileId: "participant-demo",
        startedAt: "2026-11-14T16:00:00.000Z",
      }),
      10,
      10,
    );
    const pending = services.startSession({
      id: "pending-open",
      alias: "Interrupted",
      profileId: "participant-demo",
      startedAt: "2026-11-14T16:10:00.000Z",
    });
    assert.equal(pending.status, "incomplete");
    await services.save(kept);
    await services.save(pending);
    remoteSessions = [pending, kept];
    await services.enqueueUpload({
      session: pending,
      participantId: "participant-demo",
      assignmentId: "assign-participant-demo",
    });
    assert.equal(services.queue.peek("pending-open")?.sessionId, "pending-open");

    const before = await services.listHistory();
    assert.equal(before.some((row) => row.id === "pending-open"), true);
    const beforeTrend = await services.comparableHistory(before);
    assert.equal(
      beforeTrend.trend.excluded.some((item) => item.sessionId === "pending-open" && item.reason === "unscored"),
      true,
    );
    assert.equal(
      beforeTrend.trend.points.some((point) => point.sessionId === "pending-open"),
      false,
    );

    await services.remove("pending-open");
    assert.deepEqual(deleted, ["pending-open"]);
    assert.equal(await services.load("pending-open"), null);
    assert.equal(services.queue.peek("pending-open"), undefined);

    const after = await services.listHistory();
    assert.deepEqual(
      after.map((row) => row.id).sort(),
      ["kept-1"],
    );
    const afterTrend = await services.comparableHistory(after);
    assert.equal(
      afterTrend.trend.excluded.some((item) => item.sessionId === "pending-open"),
      false,
    );
    assert.equal(
      afterTrend.trend.points.some((point) => point.sessionId === "kept-1"),
      true,
    );

    const localOnly = services.startSession({
      id: "never-uploaded",
      alias: "Local only",
      profileId: "participant-demo",
      startedAt: "2026-11-14T16:20:00.000Z",
    });
    await services.save(localOnly);
    await services.remove("never-uploaded");
    assert.deepEqual(deleted, ["pending-open", "never-uploaded"]);
    assert.equal(await services.load("never-uploaded"), null);
    const reloaded = await services.listHistory();
    assert.equal(
      reloaded.some((row) => row.id === "pending-open" || row.id === "never-uploaded"),
      false,
    );
  });
});
