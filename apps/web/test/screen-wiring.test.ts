import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENVELOPE_KEY, EnvelopeError, memoryStore } from "@neurovision/storage";
import {
  createLocalSessionStore,
  importScreenSessions,
  REJECTED_ASIDE_KEY,
  SCREEN_IMPORT_KEY,
  SCREEN_SESSIONS_KEY,
} from "../src/data/sessionStore.ts";
import { createAppServices } from "../src/services/index.ts";
import { createMemoryStore } from "../src/services/history-store.ts";
import {
  jobForSession,
  participantIdForExport,
  processingLabel,
  shouldEnqueueUpload,
  showApiControls,
} from "../src/services/screen-wiring.ts";
import type { UploadQueueState } from "../src/services/upload-queue.ts";

function liveSession() {
  const services = createAppServices({
    createId: () => "wire-1",
    now: () => new Date("2026-11-14T16:00:00.000Z"),
  });
  return services.completeSession(services.startSession({ alias: "Wired" }), {
    completedAt: "2026-11-14T16:03:00.000Z",
  });
}

describe("screen wiring", () => {
  it("hides API chrome when the service layer is standalone", () => {
    assert.equal(showApiControls(false), false);
    assert.equal(showApiControls(true), true);
    assert.equal(
      shouldEnqueueUpload({ ended: true, session: liveSession(), apiEnabled: false }),
      false,
    );
    assert.equal(
      shouldEnqueueUpload({ ended: true, session: liveSession(), apiEnabled: true }),
      true,
    );
    assert.equal(
      shouldEnqueueUpload({ ended: false, session: liveSession(), apiEnabled: true }),
      false,
    );
  });

  it("labels processing and queue state for history rows", () => {
    const queue: UploadQueueState = {
      jobs: [
        {
          id: "wire-1",
          sessionId: "wire-1",
          batchId: "wire-1-batch-1",
          participantId: "local",
          assignmentId: "assign-local",
          assignmentRevision: 1,
          startedAt: "2026-11-14T16:00:00.000Z",
          completion: "complete",
          session: liveSession(),
          traces: [],
          attempts: 0,
          nextAttemptAt: 0,
          status: "queued",
          step: "session",
          lastError: null,
        },
      ],
      pending: 1,
      uploading: 0,
      acknowledged: 0,
      blocked: 0,
      online: true,
    };
    assert.equal(processingLabel(undefined, jobForSession(queue, "wire-1")), "Queued");
    assert.equal(
      processingLabel(
        {
          sessionId: "wire-1",
          processing: "ready",
          detail: null,
          sealed: true,
          terminal: true,
        },
        jobForSession(queue, "wire-1"),
      ),
      "Ready",
    );
    assert.equal(
      participantIdForExport({ signedInParticipantId: "participant-demo", activeProfileId: "local" }),
      "participant-demo",
    );
  });

  it("saves through the service-layer HistoryStore and imports the screen envelope once", async () => {
    const kv = memoryStore();
    const history = createMemoryStore();
    const session = liveSession();
    kv.setItem(
      SCREEN_SESSIONS_KEY,
      JSON.stringify({ version: 1, records: [session, { broken: true }] }),
    );
    importScreenSessions(kv);
    assert.equal(kv.getItem(SCREEN_SESSIONS_KEY), null);
    assert.equal(kv.getItem(SCREEN_IMPORT_KEY), "1");
    const aside = JSON.parse(kv.getItem(REJECTED_ASIDE_KEY) ?? "{}") as { records: unknown[] };
    assert.equal(aside.records.length, 1);
    assert.ok(kv.getItem(ENVELOPE_KEY));

    const store = createLocalSessionStore({ history, storage: kv });
    assert.equal((await store.save(session)).ok, true);
    const loaded = await store.load();
    assert.equal(loaded.sessions.length, 1);
    assert.equal(loaded.rejected, 1);
    assert.equal((await store.remove(session.id)).ok, true);
    assert.equal((await store.load()).sessions.length, 0);
  });

  it("returns the envelope error without replacing a malformed store", async () => {
    const kv = memoryStore();
    kv.setItem(ENVELOPE_KEY, "{");
    const store = createLocalSessionStore({ storage: kv });
    const loaded = await store.load();
    assert.equal(loaded.sessions.length, 0);
    assert.match(loaded.error ?? "", /malformed|preserved/i);
    assert.equal(kv.getItem(ENVELOPE_KEY), "{");
    assert.throws(() => {
      throw new EnvelopeError();
    }, EnvelopeError);
  });

  it("keeps the standalone session store in memory", async () => {
    const kv = memoryStore();
    const store = createLocalSessionStore({ storage: kv, standalone: true });
    const session = liveSession();
    assert.equal((await store.save(session)).ok, true);
    assert.equal((await store.load()).sessions[0]?.id, session.id);
    assert.equal(kv.getItem(ENVELOPE_KEY), null);
  });

  it("uses the service-layer history even for the standalone in-memory store", async () => {
    const history = createMemoryStore();
    const kv = memoryStore();
    const store = createLocalSessionStore({ history, storage: kv, standalone: true });
    const session = liveSession();
    assert.equal((await store.save(session)).ok, true);
    assert.equal((await history.load(session.id))?.id, session.id);
    assert.equal((await store.load()).sessions.length, 1);
    assert.equal(kv.getItem(ENVELOPE_KEY), null);
    assert.equal((await store.remove(session.id)).ok, true);
    assert.equal(await history.load(session.id), null);
  });
});
