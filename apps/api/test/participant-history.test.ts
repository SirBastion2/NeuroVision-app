import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { authed, createHarness, login } from "./harness.js";
import { batchPayload, manifestFor, sampleSession } from "./fixture-session.js";

const ORG = "org-demo";

async function putLiveSession(
  app: Awaited<ReturnType<typeof createHarness>>["app"],
  auth: { cookie: string; csrf: string },
  sessionId: string,
  participantId: string,
) {
  const record = sampleSession(sessionId);
  const assignment = await app.inject({
    method: "POST",
    url: "/api/v1/assignments",
    headers: authed(auth),
    payload: {
      id: `assign-${participantId}`,
      participantId,
      exposureStatus: "unseen",
      manifest: manifestFor(record),
    },
  });
  assert.equal(assignment.statusCode, 200, assignment.body);
  const created = assignment.json() as { id: string; revision: number };
  const session = await app.inject({
    method: "PUT",
    url: `/api/v1/sessions/${sessionId}`,
    headers: authed(auth),
    payload: {
      participantId,
      assignmentId: created.id,
      assignmentRevision: created.revision,
      startedAt: record.startedAt,
      completion: "complete",
    },
  });
  assert.equal(session.statusCode, 200, session.body);
  const batch = await app.inject({
    method: "PUT",
    url: `/api/v1/sessions/${sessionId}/batches/batch-1`,
    headers: authed(auth),
    payload: batchPayload(record),
  });
  assert.equal(batch.statusCode, 200, batch.body);
  const finalized = await app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/finalize`,
    headers: authed(auth),
  });
  assert.equal(finalized.statusCode, 200, finalized.body);
  return record;
}

describe("participant history isolation", { concurrency: false }, () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  before(async () => {
    harness = await createHarness();
  });

  after(async () => {
    await harness.close();
  });

  it("rejects local participant ids that are not letters, digits, and dashes of length 3–32", async () => {
    const tooShort = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/local",
      payload: { subject: "ab", orgId: ORG },
    });
    assert.equal(tooShort.statusCode, 400);
    const badChar = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/local",
      payload: { subject: "user_name", orgId: ORG },
    });
    assert.equal(badChar.statusCode, 400);
  });

  it("lists only the signed-in participant's sessions from the API", async () => {
    const alice = await login(harness.app, "alice-1", ORG);
    await putLiveSession(harness.app, alice, "alice-session", "alice-1");
    const aliceList = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      headers: authed(alice),
    });
    assert.equal(aliceList.statusCode, 200, aliceList.body);
    const aliceIds = (aliceList.json().sessions as Array<{ id: string }>).map((item) => item.id);
    assert.equal(aliceIds.includes("alice-session"), true);

    const bob = await login(harness.app, "bob-2", ORG);
    const bobList = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      headers: authed(bob),
    });
    assert.equal(bobList.statusCode, 200, bobList.body);
    const bobIds = (bobList.json().sessions as Array<{ id: string }>).map((item) => item.id);
    assert.equal(bobIds.includes("alice-session"), false);
    assert.equal(bobIds.length, 0);

    await putLiveSession(harness.app, bob, "bob-session", "bob-2");
    const bobAfter = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      headers: authed(bob),
    });
    const bobAfterIds = (bobAfter.json().sessions as Array<{ id: string }>).map((item) => item.id);
    assert.equal(bobAfterIds.includes("bob-session"), true);
    assert.equal(bobAfterIds.includes("alice-session"), false);

    const aliceAgain = await login(harness.app, "alice-1", ORG);
    const aliceAgainList = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      headers: authed(aliceAgain),
    });
    const againIds = (aliceAgainList.json().sessions as Array<{ id: string }>).map((item) => item.id);
    assert.equal(againIds.includes("alice-session"), true);
    assert.equal(againIds.includes("bob-session"), false);
  });
});
