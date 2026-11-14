import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { one } from "../src/db.js";
import { sha256Hex } from "../src/hash.js";
import { runOnce, type WorkerDeps } from "../src/worker-lib.js";
import { batchPayload, sampleSession } from "./fixture-session.js";
import { authed, countJobs, createHarness, login, seed, world } from "./harness.js";

describe("ingestion", { concurrency: false }, () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  before(async () => {
    harness = await createHarness();
    await seed(harness.db);
  });

  after(async () => {
    await harness.close();
  });

  it("answers health without a session", async () => {
    const response = await harness.app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  });

  it("accepts an identical session retry and rejects a conflicting one", async () => {
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    const admin = await login(harness.app, world.adminA, world.orgA);
    const record = sampleSession("idem-session");
    const assignment = await harness.app.inject({
      method: "POST",
      url: "/api/v1/assignments",
      headers: authed(admin),
      payload: {
        participantId: world.participantId,
        exposureStatus: "unseen",
        manifest: {
          protocol: record.protocol,
          scorer: record.scorer,
          taskIds: record.taskIds,
          source: record.source,
          input: record.input,
          accessibilityId: "default",
          configHash: "fixture-config",
        },
      },
    });
    assert.equal(assignment.statusCode, 200, assignment.body);
    const body = {
      participantId: world.participantId,
      assignmentId: assignment.json().id as string,
      assignmentRevision: assignment.json().revision as number,
      startedAt: record.startedAt,
      completion: "complete" as const,
    };
    const first = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/idem-session",
      headers: authed(auth),
      payload: body,
    });
    const retry = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/idem-session",
      headers: authed(auth),
      payload: body,
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(retry.json().idempotent, true);
    const conflict = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/idem-session",
      headers: authed(auth),
      payload: { ...body, completion: "interrupted" },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error, "conflict");
  });

  it("rejects conflicting batches, bad hashes, bad parents, and invalid events", async () => {
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    const admin = await login(harness.app, world.adminA, world.orgA);
    const record = sampleSession("batch-session");
    const assignment = await harness.app.inject({
      method: "POST",
      url: "/api/v1/assignments",
      headers: authed(admin),
      payload: {
        participantId: world.participantId,
        exposureStatus: "unseen",
        manifest: {
          protocol: record.protocol,
          scorer: record.scorer,
          taskIds: record.taskIds,
          source: record.source,
          input: record.input,
          accessibilityId: "default",
          configHash: "fixture-config",
        },
      },
    });
    assert.equal(assignment.statusCode, 200, assignment.body);
    const opened = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/batch-session",
      headers: authed(auth),
      payload: {
        participantId: world.participantId,
        assignmentId: assignment.json().id,
        assignmentRevision: assignment.json().revision,
        startedAt: record.startedAt,
        completion: "active",
      },
    });
    assert.equal(opened.statusCode, 200, opened.body);
    const firstBatch = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/batch-session/batches/batch-1",
      headers: authed(auth),
      payload: batchPayload(record),
    });
    assert.equal(firstBatch.statusCode, 200, firstBatch.body);
    const replay = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/batch-session/batches/batch-1",
      headers: authed(auth),
      payload: batchPayload(record),
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().idempotent, true);
    const changed = structuredClone(record);
    changed.trials[0].duration = 9;
    const conflict = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/batch-session/batches/batch-1",
      headers: authed(auth),
      payload: batchPayload(changed),
    });
    assert.equal(conflict.statusCode, 409);
    const rows = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM batches WHERE session_id = 'batch-session'",
    );
    assert.equal(Number(rows?.count), 1);

    const gap = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/batch-session/batches/batch-gap",
      headers: authed(auth),
      payload: batchPayload(record, 3, "batch-1"),
    });
    assert.equal(gap.statusCode, 409);

    const badParent = batchPayload(record, 2, "missing-parent");
    const parent = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/batch-session/batches/batch-parent",
      headers: authed(auth),
      payload: badParent,
    });
    assert.equal(parent.statusCode, 409);

    const hashed = batchPayload(record, 2, "batch-1");
    const badHash = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/batch-session/batches/batch-hash",
      headers: authed(auth),
      payload: { ...hashed, contentHash: "a".repeat(64) },
    });
    assert.equal(badHash.statusCode, 400);

    const negative = structuredClone(record);
    negative.trials[0].events[0].elapsed = -5;
    const negativeResponse = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/batch-session/batches/batch-negative",
      headers: authed(auth),
      payload: batchPayload(negative, 2, "batch-1"),
    });
    assert.equal(negativeResponse.statusCode, 400);

    const unknown = structuredClone(record);
    unknown.trials[0].events[0].stimulusId = "missing-stimulus";
    const unknownResponse = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/batch-session/batches/batch-unknown",
      headers: authed(auth),
      payload: batchPayload(unknown, 2, "batch-1"),
    });
    assert.equal(unknownResponse.statusCode, 400);
  });

  it("does not enqueue analysis for a bad checksum and finalizes once", async () => {
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    const admin = await login(harness.app, world.adminA, world.orgA);
    const record = sampleSession("trace-session");
    const assignment = await harness.app.inject({
      method: "POST",
      url: "/api/v1/assignments",
      headers: authed(admin),
      payload: {
        participantId: world.participantId,
        exposureStatus: "seen",
        manifest: {
          protocol: record.protocol,
          scorer: record.scorer,
          taskIds: record.taskIds,
          source: record.source,
          input: record.input,
          accessibilityId: "default",
          configHash: "fixture-config",
        },
      },
    });
    assert.equal(assignment.statusCode, 200, assignment.body);
    const session = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/trace-session",
      headers: authed(auth),
      payload: {
        participantId: world.participantId,
        assignmentId: assignment.json().id,
        assignmentRevision: assignment.json().revision,
        startedAt: record.startedAt,
        completion: "complete",
      },
    });
    assert.equal(session.statusCode, 200, session.body);
    const batch = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/trace-session/batches/batch-1",
      headers: authed(auth),
      payload: batchPayload(record),
    });
    assert.equal(batch.statusCode, 200, batch.body);
    const bytes = new TextEncoder().encode("trace-bytes");
    const trace = await harness.app.inject({
      method: "POST",
      url: "/api/v1/sessions/trace-session/trace-uploads",
      headers: authed(auth),
      payload: {
        declaredByteCount: bytes.byteLength,
        declaredExpandedBytes: bytes.byteLength,
        declaredChecksum: sha256Hex(bytes),
        contentType: "application/octet-stream",
      },
    });
    assert.equal(trace.statusCode, 200, trace.body);
    assert.equal(trace.json().upload.adapter, "memory");
    assert.equal(trace.json().upload.localOnly, true);
    const tooLarge = await harness.app.inject({
      method: "POST",
      url: "/api/v1/sessions/trace-session/trace-uploads",
      headers: authed(auth),
      payload: {
        declaredByteCount: bytes.byteLength,
        declaredExpandedBytes: 99_000_000,
        declaredChecksum: sha256Hex(bytes),
        contentType: "application/octet-stream",
      },
    });
    assert.equal(tooLarge.statusCode, 413);
    const missingObject = await harness.app.inject({
      method: "POST",
      url: "/api/v1/sessions/trace-session/finalize",
      headers: authed(auth),
    });
    assert.equal(missingObject.statusCode, 422, missingObject.body);
    assert.equal(await countJobs(harness.db, "trace-session"), 0);
    await harness.objects.put(trace.json().objectKey as string, new TextEncoder().encode("corrupt"));
    const blocked = await harness.app.inject({
      method: "POST",
      url: "/api/v1/sessions/trace-session/finalize",
      headers: authed(auth),
    });
    assert.equal(blocked.statusCode, 422, blocked.body);
    assert.equal(blocked.json().error, "missing_dependencies");
    assert.equal(await countJobs(harness.db, "trace-session"), 0);

    const content = await harness.app.inject({
      method: "PUT",
      url: trace.json().upload.url as string,
      headers: { ...authed(auth), "content-type": "application/octet-stream" },
      payload: Buffer.from(bytes),
    });
    assert.equal(content.statusCode, 200, content.body);
    const finalized = await harness.app.inject({
      method: "POST",
      url: "/api/v1/sessions/trace-session/finalize",
      headers: authed(auth),
    });
    assert.equal(finalized.statusCode, 200, finalized.body);
    const again = await harness.app.inject({
      method: "POST",
      url: "/api/v1/sessions/trace-session/finalize",
      headers: authed(auth),
    });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().jobId, finalized.json().jobId);
    assert.equal(again.json().idempotent, true);
    assert.equal(await countJobs(harness.db, "trace-session"), 1);
    const sealed = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/trace-session/batches/batch-after-seal",
      headers: authed(auth),
      payload: batchPayload(record, 2, "batch-1"),
    });
    assert.equal(sealed.statusCode, 409);
    assert.equal(sealed.json().details.reason, "sealed");

    const worker: WorkerDeps = { ...harness.deps, workerId: "test-worker" };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const job = await one<{ status: string }>(harness.db, "SELECT status FROM jobs WHERE session_id = 'trace-session' AND kind = 'analysis'");
      if (job?.status === "succeeded") break;
      await runOnce(worker);
    }
    const summaries = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM derived_summaries WHERE session_id = 'trace-session'",
    );
    assert.equal(Number(summaries?.count), 1);
    const reviewer = await login(harness.app, world.reviewerA, world.orgA);
    const view = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/trace-session/summaries",
      headers: authed(reviewer),
    });
    assert.equal(view.statusCode, 200, view.body);
    const body = view.json();
    assert.equal(body.processing.state, "ready");
    assert.equal(body.summaries.length, 1);
    assert.equal(body.summaries[0].stub, true);
    assert.equal(body.summaries[0].gazeAnalysis.metrics, null);
    assert.equal(body.summaries[0].eligibility.gaze, false);
    assert.ok(body.summaries[0].scoring.targetSelection);
  });
});
