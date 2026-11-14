import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEMO_ORG_ID, DEMO_SUBJECTS, seedDemo } from "../src/demo-seed.js";
import { one } from "../src/db.js";
import { authed, createHarness, login } from "./harness.js";

describe("demo identity", { concurrency: false }, () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  before(async () => {
    harness = await createHarness();
  });

  after(async () => {
    await harness.close();
  });

  it("seeds an admin, a reviewer, and a participant, and local sign-in works twice", async () => {
    await seedDemo(harness.db);
    await seedDemo(harness.db);
    const participant = await one<{ label: string; subject: string }>(
      harness.db,
      "SELECT label, subject FROM participants WHERE id = $1",
      [DEMO_SUBJECTS.participant],
    );
    assert.equal(participant?.label, "Demo participant");
    assert.equal(participant?.subject, DEMO_SUBJECTS.participant);
    const assignment = await one<{ subject: string }>(
      harness.db,
      "SELECT subject FROM reviewer_assignments WHERE org_id = $1 AND participant_id = $2",
      [DEMO_ORG_ID, DEMO_SUBJECTS.participant],
    );
    assert.equal(assignment?.subject, DEMO_SUBJECTS.reviewer);

    const session = await login(harness.app, DEMO_SUBJECTS.participant, DEMO_ORG_ID);
    const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", headers: authed(session) });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().role, "participant");
    assert.equal(me.json().subject, DEMO_SUBJECTS.participant);
  });
});
