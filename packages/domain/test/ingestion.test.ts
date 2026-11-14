import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  batchPayloadFromSession,
  canTransitionCompletion,
  canTransitionProcessing,
  canTransitionSync,
  parseBatchPayload,
  parseCompletionState,
  parseProcessingState,
  parseSyncState,
  parseTraceUploadRequest,
  transitionCompletion,
  transitionProcessing,
  transitionSync,
} from "../src/index.ts";
import { makeSession } from "./session-factory.ts";

const TRACE = {
  declaredByteCount: 12,
  declaredExpandedBytes: 12,
  declaredChecksum: "abc",
  contentType: "application/octet-stream",
};

describe("ingestion state machines", () => {
  it("parses the three state unions", () => {
    assert.equal(parseCompletionState("active"), "active");
    assert.equal(parseSyncState("queued"), "queued");
    assert.equal(parseProcessingState("pending"), "pending");
    assert.throws(() => parseCompletionState("done"), /invalid completion state/);
    assert.throws(() => parseSyncState("synced"), /invalid sync state/);
    assert.throws(() => parseProcessingState("complete"), /invalid processing state/);
  });

  it("allows only listed completion, sync, and processing transitions", () => {
    assert.equal(transitionCompletion("active", "complete"), "complete");
    assert.equal(transitionCompletion("active", "interrupted"), "interrupted");
    assert.equal(canTransitionCompletion("complete", "active"), false);
    assert.throws(() => transitionCompletion("complete", "interrupted"), /completion from complete to interrupted/);

    assert.equal(transitionSync("local", "queued"), "queued");
    assert.equal(transitionSync("queued", "uploading"), "uploading");
    assert.equal(transitionSync("uploading", "acknowledged"), "acknowledged");
    assert.equal(transitionSync("uploading", "blocked"), "blocked");
    assert.equal(transitionSync("blocked", "queued"), "queued");
    assert.equal(canTransitionSync("acknowledged", "queued"), false);
    assert.throws(() => transitionSync("acknowledged", "blocked"), /sync from acknowledged to blocked/);

    assert.equal(transitionProcessing("pending", "running"), "running");
    assert.equal(transitionProcessing("running", "ready"), "ready");
    assert.equal(transitionProcessing("running", "failed"), "failed");
    assert.equal(transitionProcessing("failed", "pending"), "pending");
    assert.equal(canTransitionProcessing("ready", "failed"), false);
    assert.throws(() => transitionProcessing("ready", "running"), /processing from ready to running/);
  });
});

describe("batch payload and trace upload", () => {
  it("parses a batch of session records and traces", () => {
    const session = makeSession({ id: "batch-live", alias: "Batch", leftHits: 10, rightHits: 10 });
    const payload = batchPayloadFromSession(session, { traces: [TRACE] });
    assert.equal(payload.sequence, 1);
    assert.equal(payload.parentBatchId, null);
    assert.equal(payload.records[0]?.id, "batch-live");
    assert.equal(payload.traces[0]?.declaredByteCount, 12);
    assert.equal(parseTraceUploadRequest(TRACE).contentType, "application/octet-stream");

    const next = parseBatchPayload({
      sequence: 2,
      parentBatchId: "batch-1",
      records: [session],
      traces: [],
    });
    assert.equal(next.sequence, 2);
  });

  it("rejects a first batch with a parent, a follow-up without one, and a bad trace", () => {
    const session = makeSession({ id: "batch-bad", alias: "Bad", leftHits: 10, rightHits: 10 });
    assert.throws(
      () => parseBatchPayload({ sequence: 1, parentBatchId: "batch-0", records: [session], traces: [] }),
      /invalid batch payload/,
    );
    assert.throws(
      () => parseBatchPayload({ sequence: 2, parentBatchId: null, records: [session], traces: [] }),
      /invalid batch payload/,
    );
    assert.throws(
      () => parseTraceUploadRequest({ ...TRACE, declaredExpandedBytes: 4 }),
      /invalid trace upload request/,
    );
  });
});
