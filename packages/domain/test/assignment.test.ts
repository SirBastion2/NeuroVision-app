import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendAssignmentRevision,
  parseAssignmentManifest,
  parseExposureStatus,
  parseTaskAssignment,
  type AssignmentManifest,
  type TaskAssignment,
} from "../src/index.ts";

const MANIFEST: AssignmentManifest = {
  protocol: "spatial-v1",
  scorer: "events-v1",
  taskIds: ["target-selection", "line-bisection"],
  source: "live",
  input: "mouse-trackpad",
  accessibilityId: "default",
  configHash: "config-1",
  requestedMode: "assessment",
};

const BASE = {
  id: "assign-1",
  orgId: "org-1",
  participantId: "p-1",
  createdAt: "2026-11-14T14:00:00.000Z",
  exposureStatus: "unseen" as const,
  manifest: MANIFEST,
};

describe("assignment contracts", () => {
  it("parses exposure status and an assignment manifest", () => {
    assert.equal(parseExposureStatus("seen"), "seen");
    assert.deepEqual(parseAssignmentManifest(MANIFEST).taskIds, MANIFEST.taskIds);
    assert.throws(() => parseExposureStatus("hidden"), /invalid exposure status/);
    assert.throws(() => parseAssignmentManifest({ ...MANIFEST, source: "simulated" }), /invalid assignment manifest/);
  });

  it("appends immutable revisions with revision numbers and supersedes", () => {
    const original: TaskAssignment[] = [];
    const first = appendAssignmentRevision(original, BASE);
    assert.equal(original.length, 0);
    assert.equal(first.length, 1);
    assert.equal(first[0]?.revision, 1);
    assert.equal(first[0]?.supersedes, null);
    assert.equal(first[0]?.exposureStatus, "unseen");

    const second = appendAssignmentRevision(first, {
      ...BASE,
      createdAt: "2026-11-14T15:00:00.000Z",
      exposureStatus: "seen",
      manifest: { ...MANIFEST, requestedMode: "transfer", configHash: "config-2" },
    });
    assert.equal(first.length, 1);
    assert.equal(first[0]?.exposureStatus, "unseen");
    assert.equal(second.length, 2);
    assert.equal(second[1]?.revision, 2);
    assert.equal(second[1]?.supersedes, 1);
    assert.equal(second[1]?.exposureStatus, "seen");
    assert.equal(second[1]?.manifest.requestedMode, "transfer");
    assert.notEqual(second, first);
    assert.equal(parseTaskAssignment(second[1]!).revision, 2);
  });

  it("refuses to change assignment identity when appending a revision", () => {
    const first = appendAssignmentRevision([], BASE);
    assert.throws(
      () => appendAssignmentRevision(first, { ...BASE, participantId: "other" }),
      /identity cannot change/,
    );
  });
});
