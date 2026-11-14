import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { one } from "../src/db.js";
import { sha256Hex } from "../src/hash.js";
import { runOnce, settleJob, type WorkerDeps } from "../src/worker-lib.js";
import { authed, createHarness, login, seed, uploadSession, world } from "./harness.js";

describe("recovery", { concurrency: false }, () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;
  let worker: WorkerDeps;

  before(async () => {
    harness = await createHarness();
    await seed(harness.db);
    worker = { ...harness.deps, workerId: "recovery-worker" };
  });

  after(async () => {
    await harness.close();
  });

  it("recovers an expired lease once", async () => {
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    const uploaded = await uploadSession(harness.app, auth, "lease-session");
    await harness.db.query(
      `UPDATE jobs
       SET status = 'leased', lease_owner = 'crashed', lease_expires_at = '2000-01-01T00:00:00.000Z', attempts = 1
       WHERE id = $1`,
      [uploaded.finalized.jobId],
    );
    assert.equal((await runOnce(worker)).processed, true);
    assert.equal((await runOnce(worker)).processed, false);
    const summaries = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM derived_summaries WHERE session_id = 'lease-session'",
    );
    assert.equal(Number(summaries?.count), 1);
    const job = await one<{ status: string }>(harness.db, "SELECT status FROM jobs WHERE id = $1", [uploaded.finalized.jobId]);
    assert.equal(job?.status, "succeeded");
  });

  it("drops a leased analysis when the participant is tombstoned", async () => {
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    const uploaded = await uploadSession(harness.app, auth, "race-session");
    await harness.db.query(
      `UPDATE jobs SET status = 'leased', lease_owner = 'busy', lease_expires_at = '2999-01-01T00:00:00.000Z' WHERE id = $1`,
      [uploaded.finalized.jobId],
    );
    await harness.db.query("UPDATE participants SET deleted_at = now() WHERE id = $1", [world.participantId]);
    await settleJob(worker, uploaded.finalized.jobId);
    const job = await one<{ status: string }>(harness.db, "SELECT status FROM jobs WHERE id = $1", [uploaded.finalized.jobId]);
    assert.equal(job?.status, "cancelled");
    const summaries = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM derived_summaries WHERE session_id = 'race-session'",
    );
    assert.equal(Number(summaries?.count), 0);
    await harness.db.query("UPDATE participants SET deleted_at = NULL WHERE id = $1", [world.participantId]);
  });

  it("cleans sealed observations after deletion and expires orphan uploads", async () => {
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    await uploadSession(harness.app, auth, "cleanup-session");
    const bytes = new TextEncoder().encode("orphan-bytes");
    const trace = await harness.app.inject({
      method: "POST",
      url: "/api/v1/sessions/cleanup-session/trace-uploads",
      headers: authed(auth),
      payload: {
        declaredByteCount: bytes.byteLength,
        declaredExpandedBytes: bytes.byteLength,
        declaredChecksum: sha256Hex(bytes),
        contentType: "application/octet-stream",
      },
    });
    assert.equal(trace.statusCode, 409, trace.body);

    const orphanAuth = await login(harness.app, world.participantSubject, world.orgA);
    const open = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/sessions/orphan-session",
      headers: authed(orphanAuth),
      payload: {
        participantId: world.participantId,
        assignmentId: (await one<{ assignment_id: string }>(harness.db, "SELECT assignment_id FROM sessions WHERE id = 'cleanup-session'"))?.assignment_id,
        assignmentRevision: 1,
        startedAt: "2026-11-01T14:00:00.000Z",
        completion: "active",
      },
    });
    assert.equal(open.statusCode, 200, open.body);
    const orphan = await harness.app.inject({
      method: "POST",
      url: "/api/v1/sessions/orphan-session/trace-uploads",
      headers: authed(orphanAuth),
      payload: {
        declaredByteCount: bytes.byteLength,
        declaredExpandedBytes: bytes.byteLength,
        declaredChecksum: sha256Hex(bytes),
        contentType: "application/octet-stream",
      },
    });
    assert.equal(orphan.statusCode, 200, orphan.body);
    await harness.objects.put(orphan.json().objectKey as string, bytes);
    await harness.db.query("UPDATE trace_refs SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = $1", [orphan.json().traceId]);
    await runOnce(worker);
    const expired = await one<{ status: string }>(harness.db, "SELECT status FROM trace_refs WHERE id = $1", [orphan.json().traceId]);
    assert.equal(expired?.status, "expired");
    assert.equal(await harness.objects.get(orphan.json().objectKey as string), null);

    const admin = await login(harness.app, world.adminA, world.orgA);
    const deleted = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/participants/${world.participantId}`,
      headers: authed(admin),
      payload: { confirm: true },
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    let guard = 0;
    while ((await runOnce(worker)).processed && guard < 10) guard += 1;
    const batches = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM batches WHERE session_id = 'cleanup-session'",
    );
    assert.equal(Number(batches?.count), 0);
    const tombstone = await one<{ deleted_at: Date | null }>(
      harness.db,
      "SELECT deleted_at FROM participants WHERE id = $1",
      [world.participantId],
    );
    assert.ok(tombstone?.deleted_at);
    const reviewer = await login(harness.app, world.reviewerA, world.orgA);
    const hidden = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/cleanup-session",
      headers: authed(reviewer),
    });
    assert.equal(hidden.statusCode, 404);
  });

  it("keeps the sealed document when analysis fails and does not replace a successful summary", async () => {
    await harness.db.query("UPDATE participants SET deleted_at = NULL WHERE id = $1", [world.participantId]);
    const auth = await login(harness.app, world.participantSubject, world.orgA);
    const failed = await uploadSession(harness.app, auth, "fail-session");
    await harness.db.query("UPDATE jobs SET max_attempts = 1 WHERE id = $1", [failed.finalized.jobId]);
    await harness.db.query("UPDATE session_documents SET record = '{\"broken\":true}'::jsonb WHERE session_id = 'fail-session'");
    assert.equal((await runOnce(worker)).processed, true);
    const failedJob = await one<{ status: string; last_error: string | null }>(
      harness.db,
      "SELECT status, last_error FROM jobs WHERE id = $1",
      [failed.finalized.jobId],
    );
    assert.equal(failedJob?.status, "failed");
    assert.match(failedJob?.last_error ?? "", /invalid session record/);
    const failedSession = await one<{ processing_state: string }>(
      harness.db,
      "SELECT processing_state FROM sessions WHERE id = 'fail-session'",
    );
    assert.equal(failedSession?.processing_state, "failed");
    const retained = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM session_documents WHERE session_id = 'fail-session'",
    );
    assert.equal(Number(retained?.count), 1);
    const failedSummaries = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM derived_summaries WHERE session_id = 'fail-session'",
    );
    assert.equal(Number(failedSummaries?.count), 0);

    const kept = await uploadSession(harness.app, auth, "keep-session");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const job = await one<{ status: string }>(harness.db, "SELECT status FROM jobs WHERE id = $1", [kept.finalized.jobId]);
      if (job?.status === "succeeded") break;
      await runOnce(worker);
    }
    const before = await one<{ summary: unknown }>(
      harness.db,
      "SELECT summary FROM derived_summaries WHERE session_id = 'keep-session'",
    );
    await harness.db.query(
      "UPDATE jobs SET status = 'queued', attempts = 0, lease_owner = NULL, lease_expires_at = NULL WHERE id = $1",
      [kept.finalized.jobId],
    );
    assert.equal((await runOnce(worker)).processed, true);
    const copies = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM derived_summaries WHERE session_id = 'keep-session'",
    );
    assert.equal(Number(copies?.count), 1);
    const after = await one<{ summary: unknown }>(
      harness.db,
      "SELECT summary FROM derived_summaries WHERE session_id = 'keep-session'",
    );
    assert.equal(JSON.stringify(after?.summary), JSON.stringify(before?.summary));
    const ready = await one<{ processing_state: string }>(
      harness.db,
      "SELECT processing_state FROM sessions WHERE id = 'keep-session'",
    );
    assert.equal(ready?.processing_state, "ready");
  });
});
