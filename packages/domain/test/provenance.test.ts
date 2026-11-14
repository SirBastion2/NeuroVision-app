import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachGazeSampleProvenance,
  isSessionRecord,
  mapImportedSource,
  parseGazeSample,
  parseGazeSampleProvenanceRequest,
  parseImportedSourceProvenance,
  SESSION_SOURCES,
  sessionSourceFromImport,
} from "../src/index.ts";
import { makeSession } from "./session-factory.ts";

describe("gaze sample provenance", () => {
  it("keeps GazeSample as elapsed/x/y and attaches provenance alongside", () => {
    const mixed = { elapsed: 120, x: 10, y: 20, captureMs: 999, inferenceDoneMs: 1000 };
    const sample = parseGazeSample(mixed);
    assert.deepEqual(sample, { elapsed: 120, x: 10, y: 20 });
    assert.equal("captureMs" in sample, false);

    const provenance = parseGazeSampleProvenanceRequest({
      captureMs: 40,
      inferenceDoneMs: 55,
      timestampBasis: "frame",
    });
    const paired = attachGazeSampleProvenance(mixed, provenance);
    assert.deepEqual(paired.sample, { elapsed: 120, x: 10, y: 20 });
    assert.deepEqual(paired.provenance, provenance);
    assert.equal("captureMs" in paired.sample, false);
    assert.equal("elapsed" in paired.provenance, false);
    assert.throws(
      () => parseGazeSampleProvenanceRequest({ captureMs: 80, inferenceDoneMs: 40, timestampBasis: "frame" }),
      /invalid gaze sample provenance request/,
    );
  });
});

describe("imported source provenance", () => {
  it("maps simulated imports to demonstration and never to live", () => {
    assert.deepEqual(SESSION_SOURCES, ["live", "demonstration"]);
    assert.equal(mapImportedSource("live"), "live");
    assert.equal(mapImportedSource("simulated"), "demonstration");
    assert.notEqual(mapImportedSource("simulated"), "live");

    const simulated = parseImportedSourceProvenance({ original: "simulated" });
    const stored = sessionSourceFromImport(simulated);
    assert.equal(stored, "demonstration");
    assert.notEqual(stored, "live");
    assert.equal(simulated.original, "simulated");

    const session = makeSession({ id: "imported-sim", alias: "Imported", leftHits: 10, rightHits: 10 });
    assert.equal(isSessionRecord({ ...session, source: "simulated" }), false);
    assert.equal(isSessionRecord({ ...session, source: "observed" }), false);
    assert.equal(isSessionRecord({ ...session, source: stored }), true);
  });
});
