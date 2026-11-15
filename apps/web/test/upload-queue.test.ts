import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSessionRecord } from "@neurovision/domain";
import { assembleBatteryRecord } from "../src/data/batterySession.ts";
import {
  ApiError,
  ApiOfflineError,
  createApiClient,
  createAppServices,
  createMemoryKeyValueStore,
  createUploadQueue,
  UPLOAD_QUEUE_KEY,
  type SessionRecord,
} from "../src/services/index.ts";

function sessionRecord(id = "sess-1"): SessionRecord {
  const services = createAppServices({
    createId: () => id,
    now: () => new Date("2026-11-14T16:00:00.000Z"),
  });
  return parseSessionRecord(
    services.completeSession(services.startSession({ alias: "Queued", id, startedAt: "2026-11-14T16:00:00.000Z" }), {
      completedAt: "2026-11-14T16:03:00.000Z",
    }),
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("offline upload queue", () => {
  it("persists a pending upload, retries with backoff when online, and is idempotent by session and batch id", async () => {
    const delays: number[] = [];
    const calls: string[] = [];
    let failPuts = 1;
    let clock = 1_000;
    const store = createMemoryKeyValueStore();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.includes("/sessions/sess-1") && method === "PUT" && !url.includes("/batches")) {
        if (failPuts > 0) {
          failPuts -= 1;
          return jsonResponse(503, { error: "unavailable", message: "offline" });
        }
        return jsonResponse(200, {
          id: "sess-1",
          participantId: "local",
          assignmentId: "assign-local",
          assignmentRevision: 1,
          startedAt: "2026-11-14T16:00:00.000Z",
          completion: "complete",
          sync: "uploading",
          processing: "pending",
          sealed: false,
          sessionRevision: 0,
          inputHash: null,
        });
      }
      if (url.includes("/batches/") && method === "PUT") {
        return jsonResponse(200, { batchId: "sess-1-batch-1", sequence: 1, idempotent: false });
      }
      if (url.endsWith("/finalize") && method === "POST") {
        return jsonResponse(200, {
          sessionId: "sess-1",
          sealed: true,
          idempotent: false,
          jobId: "job-1",
          inputHash: "abc",
          processing: "pending",
        });
      }
      return jsonResponse(404, { error: "not_found", message: "missing" });
    };
    const api = createApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
    });
    const queue = createUploadQueue({
      api,
      store,
      isOnline: () => true,
      now: () => clock,
      sleep: async (ms) => {
        delays.push(ms);
        clock += ms;
      },
      initialDelayMs: 250,
      maxDelayMs: 4_000,
    });

    const session = sessionRecord();
    const first = await queue.enqueue({ session });
    assert.equal(first.id, "sess-1");
    assert.equal(first.batchId, "sess-1-batch-1");
    await queue.drain();
    await Promise.resolve();
    await queue.drain();
    const done = queue.peek("sess-1");
    assert.equal(done?.status, "acknowledged");
    assert.equal(done?.step, "done");
    assert.equal(done?.attempts, 1);
    assert.deepEqual(delays, [250]);

    const raw = store.getItem(UPLOAD_QUEUE_KEY);
    assert.ok(raw);
    assert.match(raw ?? "", /sess-1/);

    const again = await queue.enqueue({ session });
    assert.equal(again.status, "acknowledged");
    const putCount = calls.filter((call) => call.startsWith("PUT https://api.example.test/api/v1/sessions/sess-1") && !call.includes("/batches")).length;
    assert.equal(putCount, 2);

    const restored = createUploadQueue({
      api,
      store,
      isOnline: () => true,
      sleep: async () => undefined,
    });
    assert.equal(restored.peek("sess-1")?.status, "acknowledged");
    assert.equal(restored.getState().acknowledged, 1);
  });

  it("holds jobs while offline and drains them when connectivity returns", async () => {
    let online = false;
    const calls: string[] = [];
    const listeners: Array<() => void> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input).includes("/batches/")) {
        return jsonResponse(200, { batchId: "sess-2-batch-1", sequence: 1, idempotent: true });
      }
      if (String(input).endsWith("/finalize")) {
        return jsonResponse(200, {
          sessionId: "sess-2",
          sealed: true,
          idempotent: true,
          jobId: "job-2",
          inputHash: "def",
          processing: "pending",
        });
      }
      return jsonResponse(200, {
        id: "sess-2",
        participantId: "local",
        assignmentId: "assign-local",
        assignmentRevision: 1,
        startedAt: "2026-11-14T16:00:00.000Z",
        completion: "complete",
        sync: "uploading",
        processing: "pending",
        sealed: false,
        sessionRevision: 0,
        inputHash: null,
      });
    };
    const queue = createUploadQueue({
      api: createApiClient({ baseUrl: "https://api.example.test", fetch: fetchImpl }),
      store: createMemoryKeyValueStore(),
      isOnline: () => online,
      listenOnline: (handler) => {
        listeners.push(handler);
        return () => undefined;
      },
      sleep: async () => undefined,
    });
    await queue.enqueue({ session: sessionRecord("sess-2") });
    assert.equal(calls.length, 0);
    assert.equal(queue.getState().pending, 1);
    online = true;
    listeners.forEach((handler) => handler());
    await queue.drain();
    assert.equal(queue.peek("sess-2")?.status, "acknowledged");
    assert.ok(calls.some((call) => call.includes("/finalize")));
  });

  it("treats a 409 on session or batch as already stored and continues", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "PUT" && url.includes("/sessions/") && !url.includes("/batches")) {
        return jsonResponse(409, { error: "conflict", message: "already stored" });
      }
      if (url.includes("/batches/")) {
        return jsonResponse(409, { error: "conflict", message: "batch exists" });
      }
      return jsonResponse(200, {
        sessionId: "sess-3",
        sealed: true,
        idempotent: true,
        jobId: "job-3",
        inputHash: "ghi",
        processing: "pending",
      });
    };
    const queue = createUploadQueue({
      api: createApiClient({ baseUrl: "https://api.example.test", fetch: fetchImpl }),
      store: createMemoryKeyValueStore(),
      sleep: async () => undefined,
    });
    await queue.enqueue({ session: sessionRecord("sess-3") });
    await queue.drain();
    assert.equal(queue.peek("sess-3")?.status, "acknowledged");
  });

  it("does not call the API from a standalone service", async () => {
    const services = createAppServices({
      standalone: true,
      fetch: async () => {
        throw new Error("standalone must not call fetch");
      },
    });
    await assert.rejects(
      () => services.enqueueUpload({ session: sessionRecord("sess-offline") }),
      ApiOfflineError,
    );
    assert.equal(services.queueState().pending, 0);
  });

  it("surfaces queue state through createAppServices", async () => {
    const kv = createMemoryKeyValueStore();
    const services = createAppServices({
      keyValueStore: kv,
      config: { apiBaseUrl: "https://api.example.test", standalone: false },
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes("/batches/")) return jsonResponse(200, { batchId: "x", sequence: 1, idempotent: false });
        if (url.endsWith("/finalize")) {
          return jsonResponse(200, {
            sessionId: "sess-4",
            sealed: true,
            idempotent: false,
            jobId: "j",
            inputHash: "h",
            processing: "pending",
          });
        }
        if ((init?.method ?? "GET") === "PUT") {
          return jsonResponse(200, {
            id: "sess-4",
            participantId: "local",
            assignmentId: "assign-local",
            assignmentRevision: 1,
            startedAt: "2026-11-14T16:00:00.000Z",
            completion: "complete",
            sync: "uploading",
            processing: "pending",
            sealed: false,
            sessionRevision: 0,
            inputHash: null,
          });
        }
        throw new ApiError(404, "not_found", "missing");
      },
    });
    const updates: number[] = [];
    const stop = services.subscribeQueue((state) => updates.push(state.jobs.length));
    await services.enqueueUpload({ session: sessionRecord("sess-4") });
    await services.drainQueue();
    assert.equal(services.queueState().acknowledged, 1);
    assert.ok(updates.length >= 1);
    stop();
    assert.equal(services.storeKind, "package");
  });

  it("uploads the battery record after the session batch and before finalize", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.includes("/battery") && method === "PUT") {
        return jsonResponse(200, { sessionId: "sess-battery", sealed: false, battery: true });
      }
      if (url.includes("/batches/") && method === "PUT") {
        return jsonResponse(200, { batchId: "sess-battery-batch-1", sequence: 1, idempotent: false });
      }
      if (url.endsWith("/finalize") && method === "POST") {
        return jsonResponse(200, {
          sessionId: "sess-battery",
          sealed: true,
          idempotent: false,
          jobId: "job-b",
          inputHash: "hash",
          processing: "pending",
        });
      }
      return jsonResponse(200, {
        id: "sess-battery",
        participantId: "local",
        assignmentId: "assign-local",
        assignmentRevision: 1,
        startedAt: "2026-11-14T16:00:00.000Z",
        completion: "complete",
        sync: "uploading",
        processing: "pending",
        sealed: false,
        sessionRevision: 0,
        inputHash: null,
      });
    };
    const queue = createUploadQueue({
      api: createApiClient({ baseUrl: "https://api.example.test", fetch: fetchImpl }),
      store: createMemoryKeyValueStore(),
      sleep: async () => undefined,
    });
    const session = sessionRecord("sess-battery");
    const battery = assembleBatteryRecord(
      { mode: "full", hide: "none", seed: 7, readingDirection: null, consent: true, healthyControl: true },
      {
        scene: { taps: [] },
        clock: { trials: [], responses: [] },
        detection: { left: { hits: 6, targets: 8 }, right: { hits: 7, targets: 8 } },
      },
      { id: "sess-battery", startedAt: session.startedAt, completedAt: session.completedAt },
    );
    await queue.enqueue({ session, battery });
    await queue.drain();
    assert.equal(queue.peek("sess-battery")?.status, "acknowledged");
    const batteryIdx = calls.findIndex((call) => call.includes("/battery"));
    const batchIdx = calls.findIndex((call) => call.includes("/batches/"));
    const finalizeIdx = calls.findIndex((call) => call.includes("/finalize"));
    assert.ok(batteryIdx > batchIdx);
    assert.ok(finalizeIdx > batteryIdx);
  });
});
