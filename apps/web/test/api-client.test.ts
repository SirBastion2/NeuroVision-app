import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ApiOfflineError,
  createAppServices,
  createApiClient,
  deleteParticipant,
  exportParticipant,
  pollProcessingState,
  type ProcessingSnapshot,
} from "../src/services/index.ts";

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function headerRecord(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(handler: (call: MockCall) => Response | Promise<Response>) {
  const calls: MockCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const call: MockCall = {
      url: request.url,
      method: request.method,
      headers: headerRecord(request.headers),
      body: init?.body === undefined ? null : typeof init.body === "string" ? init.body : null,
    };
    if (call.body === null && init?.body instanceof Uint8Array) {
      call.body = `bytes:${init.body.byteLength}`;
    }
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

function sessionBody(processing: string, extras: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    participantId: "part-1",
    assignmentId: "assign-1",
    assignmentRevision: 1,
    startedAt: "2026-11-14T16:00:00.000Z",
    completion: "complete",
    sync: "acknowledged",
    processing,
    sealed: true,
    sessionRevision: 1,
    inputHash: "abc",
    processingDetail: {
      state: processing,
      retryable: false,
      lastError: null,
      jobStatus: processing === "ready" ? "succeeded" : "leased",
    },
    ...extras,
  };
}

describe("typed API client", () => {
  it("polls processing state with backoff and stops on a terminal state", async () => {
    const states = ["pending", "running", "ready"];
    const { fetchImpl, calls } = mockFetch((call) => {
      assert.match(call.url, /\/api\/v1\/sessions\/session-1$/);
      assert.equal(call.method, "GET");
      const processing = states.shift() ?? "ready";
      return jsonResponse(200, sessionBody(processing));
    });
    const delays: number[] = [];
    const updates: ProcessingSnapshot[] = [];
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
      getAccessToken: () => "token-1",
    });
    const snapshot = await pollProcessingState(client, "session-1", {
      initialDelayMs: 250,
      multiplier: 2,
      maxDelayMs: 4_000,
      sleep: async (ms) => {
        delays.push(ms);
      },
      onUpdate: (value) => updates.push(value),
    });
    assert.equal(snapshot.processing, "ready");
    assert.equal(snapshot.terminal, true);
    assert.deepEqual(delays, [250, 500]);
    assert.deepEqual(
      updates.map((item) => item.processing),
      ["pending", "running", "ready"],
    );
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.headers.authorization, "Bearer token-1");
  });

  it("exports and deletes through the participant routes", async () => {
    const { fetchImpl, calls } = mockFetch((call) => {
      if (call.method === "POST") {
        return jsonResponse(200, { exportId: "exp-1", bundle: { version: 1, sessions: [] } });
      }
      return jsonResponse(200, { participantId: "part-1", deleted: true, idempotent: false });
    });
    const client = createApiClient({
      baseUrl: "https://api.example.test/",
      fetch: fetchImpl,
      getAccessToken: () => "token-2",
    });
    const exported = await exportParticipant(client, "part-1");
    const deleted = await deleteParticipant(client, "part-1");
    assert.equal(exported.exportId, "exp-1");
    assert.equal(deleted.deleted, true);
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.url, "https://api.example.test/api/v1/participants/part-1/exports");
    assert.equal(calls[0]?.headers.authorization, "Bearer token-2");
    assert.equal(calls[1]?.method, "DELETE");
    assert.equal(calls[1]?.url, "https://api.example.test/api/v1/participants/part-1");
    assert.equal(calls[1]?.body, JSON.stringify({ confirm: true }));
  });

  it("uploads a session and a trace", async () => {
    const { fetchImpl, calls } = mockFetch((call) => {
      if (call.url.endsWith("/api/v1/sessions/session-1") && call.method === "PUT") {
        return jsonResponse(200, sessionBody("pending", { sealed: false, sync: "uploading" }));
      }
      if (call.url.endsWith("/trace-uploads") && call.method === "POST") {
        return jsonResponse(200, {
          traceId: "trace-1",
          objectKey: "orgs/o/sessions/session-1/traces/trace-1",
          expiresAt: "2026-11-14T17:00:00.000Z",
          upload: {
            method: "PUT",
            url: "/api/v1/sessions/session-1/trace-uploads/trace-1/content",
            headers: { "content-type": "application/octet-stream" },
            adapter: "memory",
            localOnly: true,
          },
        });
      }
      return jsonResponse(200, { traceId: "trace-1", status: "uploaded" });
    });
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
    });
    const session = await client.putSession({
      sessionId: "session-1",
      participantId: "part-1",
      assignmentId: "assign-1",
      assignmentRevision: 1,
      startedAt: "2026-11-14T16:00:00.000Z",
      completion: "complete",
    });
    const trace = await client.uploadTrace(
      "session-1",
      {
        declaredByteCount: 4,
        declaredExpandedBytes: 4,
        declaredChecksum: "a".repeat(64),
        contentType: "application/octet-stream",
      },
      new Uint8Array([1, 2, 3, 4]),
    );
    assert.equal(session.id, "session-1");
    assert.equal(trace.status, "uploaded");
    assert.equal(calls[0]?.method, "PUT");
    assert.equal(calls[1]?.method, "POST");
    assert.equal(calls[2]?.url, "https://api.example.test/api/v1/sessions/session-1/trace-uploads/trace-1/content");
  });

  it("does not call fetch when the API is disabled", async () => {
    let called = 0;
    const fetchImpl: typeof fetch = async () => {
      called += 1;
      throw new Error("fetch should not run");
    };
    const client = createApiClient({
      baseUrl: "",
      standalone: true,
      fetch: fetchImpl,
    });
    assert.equal(client.enabled, false);
    await assert.rejects(() => client.health(), ApiOfflineError);
    await assert.rejects(() => pollProcessingState(client, "session-1"), ApiOfflineError);
    await assert.rejects(() => exportParticipant(client, "part-1"), ApiOfflineError);
    await assert.rejects(() => deleteParticipant(client, "part-1"), ApiOfflineError);
    await assert.rejects(() => client.deleteSession("session-1"), ApiOfflineError);
    assert.equal(called, 0);
  });

  it("deletes a session through DELETE /api/v1/sessions/:sessionId", async () => {
    const { fetchImpl, calls } = mockFetch((call) => {
      return jsonResponse(200, { sessionId: "session-1", deleted: true, idempotent: false });
    });
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
      getCsrfToken: () => "csrf-session",
    });
    const deleted = await client.deleteSession("session-1");
    assert.equal(deleted.deleted, true);
    assert.equal(calls[0]?.method, "DELETE");
    assert.equal(calls[0]?.url, "https://api.example.test/api/v1/sessions/session-1");
    assert.equal(calls[0]?.headers["x-csrf-token"], "csrf-session");
  });

  it("exposes dashboard polling, export, and delete on createAppServices", async () => {
    const states = ["pending", "failed"];
    const { fetchImpl, calls } = mockFetch((call) => {
      if (call.url.endsWith("/health")) return jsonResponse(200, { status: "ok" });
      if (call.url.endsWith("/exports")) return jsonResponse(200, { exportId: "exp-2", bundle: {} });
      if (call.method === "DELETE") {
        return jsonResponse(200, { participantId: "part-9", deleted: true, idempotent: true });
      }
      return jsonResponse(200, sessionBody(states.shift() ?? "failed"));
    });
    const services = createAppServices({
      config: {
        apiBaseUrl: "https://api.example.test",
        standalone: false,
      },
      fetch: fetchImpl,
    });
    assert.equal(services.apiEnabled, true);
    assert.deepEqual(await services.health(), { status: "ok" });
    const processed = await services.pollProcessingState("session-1", {
      sleep: async () => undefined,
    });
    assert.equal(processed.processing, "failed");
    assert.equal(processed.terminal, true);
    const exported = await services.exportParticipant("part-9");
    const deleted = await services.deleteParticipant("part-9");
    assert.equal(exported.exportId, "exp-2");
    assert.equal(deleted.idempotent, true);
    assert.ok(calls.some((call) => call.url.endsWith("/health")));
  });
});
