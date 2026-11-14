import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { asJson, one } from "../src/db.js";
import { authed, createHarness, login, seed, world } from "./harness.js";
import { sampleSession } from "./fixture-session.js";

describe("legacy import", { concurrency: false }, () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  before(async () => {
    harness = await createHarness();
    await seed(harness.db);
  });

  after(async () => {
    await harness.close();
  });

  it("maps live and simulated sources, keeps malformed rows, and dedupes", async () => {
    const reviewer = await login(harness.app, world.reviewerA, world.orgA);
    const live = sampleSession("legacy-live");
    const simulated = sampleSession("legacy-sim");
    const legacySimulated = {
      ...simulated,
      source: "simulated",
      trials: simulated.trials.map((trial) => ({ ...trial, task: "cancellation" })),
    };
    const malformed = { id: "legacy-bad", profileId: "local", source: "simulated", alias: 12 };
    const envelope = { version: 1, seeded: true, sessions: [live, legacySimulated, malformed] };
    const preview = await harness.app.inject({
      method: "POST",
      url: "/api/v1/imports/legacy/preview",
      headers: authed(reviewer),
      payload: { envelope },
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().dispositions.length, 3);
    assert.equal(preview.json().dispositions[2].status, "invalid");

    const imported = await harness.app.inject({
      method: "POST",
      url: "/api/v1/imports/legacy",
      headers: authed(reviewer),
      payload: { participantId: world.participantId, envelope },
    });
    assert.equal(imported.statusCode, 200, imported.body);
    const dispositions = imported.json().dispositions as Array<{
      status: string;
      originalSource: string;
      storedSource: string | null;
      sessionId: string | null;
    }>;
    assert.equal(dispositions[0]?.status, "imported");
    assert.equal(dispositions[0]?.originalSource, "live");
    assert.equal(dispositions[0]?.storedSource, "live");
    assert.equal(dispositions[1]?.status, "imported");
    assert.equal(dispositions[1]?.originalSource, "simulated");
    assert.equal(dispositions[1]?.storedSource, "demonstration");
    assert.notEqual(dispositions[1]?.storedSource, "live");
    assert.equal(dispositions[2]?.status, "rejected");

    const view = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/legacy-sim",
      headers: authed(reviewer),
    });
    assert.equal(view.statusCode, 200, view.body);
    assert.equal(view.json().record.source, "demonstration");
    assert.equal(view.json().record.trials[0].task, "target-selection");
    const provenance = await one<{ provenance: unknown }>(
      harness.db,
      "SELECT provenance FROM session_documents WHERE session_id = 'legacy-sim'",
    );
    assert.equal(asJson<{ originalSource: string }>(provenance?.provenance).originalSource, "simulated");
    const kept = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM legacy_imports WHERE dedupe_key = 'simulated:local:legacy-bad' AND status = 'rejected'",
    );
    assert.equal(Number(kept?.count), 1);
    const dropped = await one<{ count: number }>(harness.db, "SELECT COUNT(*)::int AS count FROM sessions WHERE id = 'legacy-bad'");
    assert.equal(Number(dropped?.count), 0);

    const duplicate = await harness.app.inject({
      method: "POST",
      url: "/api/v1/imports/legacy",
      headers: authed(reviewer),
      payload: { participantId: world.participantId, envelope: { version: 1, seeded: true, sessions: [legacySimulated] } },
    });
    assert.equal(duplicate.json().dispositions[0].status, "duplicate");
    const copies = await one<{ count: number }>(harness.db, "SELECT COUNT(*)::int AS count FROM sessions WHERE id = 'legacy-sim'");
    assert.equal(Number(copies?.count), 1);
  });

  it("lists every session when the envelope version is wrong", async () => {
    const reviewer = await login(harness.app, world.reviewerA, world.orgA);
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/imports/legacy",
      headers: authed(reviewer),
      payload: {
        participantId: world.participantId,
        envelope: { version: 2, seeded: false, sessions: [sampleSession("legacy-v2"), { nope: true }] },
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    const dispositions = response.json().dispositions as Array<{ status: string }>;
    assert.equal(dispositions.length, 2);
    assert.equal(dispositions.every((item) => item.status === "rejected"), true);
    const stored = await one<{ count: number }>(
      harness.db,
      "SELECT COUNT(*)::int AS count FROM legacy_imports WHERE status = 'rejected'",
    );
    assert.ok(Number(stored?.count) >= 2);
  });
});
