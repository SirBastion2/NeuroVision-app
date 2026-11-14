import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GAZE_ANALYSIS_VERSION } from "@neurovision/gaze";
import { sha256Hex } from "../src/hash.js";
import { runOnce, type WorkerDeps } from "../src/worker-lib.js";
import { batchPayload, manifestFor, sampleSession } from "./fixture-session.js";
import { authed, createHarness, login, seed, world } from "./harness.js";

function traceDocument(trialId: string, durationMs: number, validationErrorPx: number[]): Uint8Array {
  const samples = [];
  for (let elapsed = 0; elapsed < durationMs; elapsed += 100) {
    samples.push({ elapsed, x: 200, y: 270 });
  }
  return new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      trialId,
      streamKind: "webcam",
      samples,
      validationErrorPx,
    }),
  );
}

describe("worker gaze traces", { concurrency: false }, () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  before(async () => {
    harness = await createHarness();
    await seed(harness.db);
  });

  after(async () => {
    await harness.close();
  });

  async function sealWithTrace(sessionId: string, validationErrorPx: number[]) {
    const record = sampleSession(sessionId);
    const bytes = traceDocument(record.trials[0].id, record.trials[0].duration, validationErrorPx);
    const admin = await login(harness.app, world.adminA, world.orgA);
    const participant = await login(harness.app, world.participantSubject, world.orgA);
    const assignment = await harness.app.inject({
      method: "POST",
      url: "/api/v1/assignments",
      headers: authed(admin),
      payload: { participantId: world.participantId, exposureStatus: "unseen", manifest: manifestFor(record) },
    });
    assert.equal(assignment.statusCode, 200, assignment.body);
    const session = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/sessions/${sessionId}`,
      headers: authed(participant),
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
      url: `/api/v1/sessions/${sessionId}/batches/batch-1`,
      headers: authed(participant),
      payload: batchPayload(record),
    });
    assert.equal(batch.statusCode, 200, batch.body);
    const trace = await harness.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/trace-uploads`,
      headers: authed(participant),
      payload: {
        declaredByteCount: bytes.byteLength,
        declaredExpandedBytes: bytes.byteLength,
        declaredChecksum: sha256Hex(bytes),
        contentType: "application/json",
      },
    });
    assert.equal(trace.statusCode, 200, trace.body);
    const uploaded = await harness.app.inject({
      method: "PUT",
      url: trace.json().upload.url as string,
      headers: { ...authed(participant), "content-type": "application/octet-stream" },
      payload: Buffer.from(bytes),
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const finalized = await harness.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/finalize`,
      headers: authed(participant),
    });
    assert.equal(finalized.statusCode, 200, finalized.body);
  }

  it("reads a stored trace and records gaze metrics or an ineligible result", async () => {
    await sealWithTrace("gaze-valid", [10, 12, 8]);
    await sealWithTrace("gaze-poor", [200, 220, 240]);
    const worker: WorkerDeps = { ...harness.deps, workerId: "gaze-worker" };
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await runOnce(worker);
      if (!result.processed) break;
    }
    const reviewer = await login(harness.app, world.reviewerA, world.orgA);
    const valid = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/gaze-valid/summaries",
      headers: authed(reviewer),
    });
    assert.equal(valid.statusCode, 200, valid.body);
    const validBody = valid.json();
    assert.equal(validBody.processing.state, "ready");
    assert.equal(validBody.summaries[0].eligibility.gaze, true);
    assert.equal(validBody.summaries[0].gazeAnalysis.version, GAZE_ANALYSIS_VERSION);
    assert.equal(typeof validBody.summaries[0].gazeAnalysis.trials[0].metrics.coverageRatio, "number");

    const poor = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/gaze-poor/summaries",
      headers: authed(reviewer),
    });
    assert.equal(poor.statusCode, 200, poor.body);
    const poorBody = poor.json();
    assert.equal(poorBody.processing.state, "ready");
    assert.equal(poorBody.summaries[0].eligibility.click, true);
    assert.equal(poorBody.summaries[0].eligibility.gaze, false);
    assert.equal(
      poorBody.summaries[0].gazeAnalysis.trials[0].eligibility.reasons.includes("gaze_resolution_none"),
      true,
    );
    assert.equal(typeof poorBody.summaries[0].gazeAnalysis.trials[0].metrics.sampleCount, "number");
  });
});
