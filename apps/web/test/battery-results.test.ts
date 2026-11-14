import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BATTERY_CONTRACT_VERSION,
  generateBisectionLines,
  generateClockTrials,
  generateGreyscalesTrials,
  generateScene,
  parseBatteryRecord,
  type BatteryRecord,
} from "@neurovision/domain";
import { buildClinicianReportPdf } from "../src/profile/report-pdf.ts";
import {
  BatteryResults,
  batteryDisplay,
  serializeBatteryRecord,
} from "../src/screens/BatteryResults.tsx";

function fixtureRecord(overrides: Partial<BatteryRecord> = {}): BatteryRecord {
  const seed = 11;
  const hide = "left" as const;
  const scene = generateScene({ seed, hide });
  const taps = scene.lanterns
    .filter((lantern) => lantern.lit && lantern.x >= scene.visible.x0 && lantern.x < scene.visible.x1)
    .slice(0, 5)
    .map((lantern, index) => ({ t: index * 400, x: lantern.x, y: lantern.y }));
  const clockTrials = generateClockTrials(4, seed);
  const greyTrials = generateGreyscalesTrials(4, seed);
  const lines = generateBisectionLines(4, seed);
  return parseBatteryRecord({
    contract: BATTERY_CONTRACT_VERSION,
    id: "battery-results-1",
    mode: "full",
    hide,
    seed,
    readingDirection: "left-to-right",
    consent: true,
    source: "live",
    startedAt: "2026-11-14T12:00:00.000Z",
    completedAt: "2026-11-14T12:08:00.000Z",
    scene: { taps },
    clock: {
      trials: clockTrials,
      responses: clockTrials.map((trial) => ({ trialId: trial.id, choice: trial.correctPosition, rtMs: 800 })),
    },
    greyscales: {
      trials: greyTrials,
      responses: greyTrials.map((trial) => ({ trialId: trial.id, choice: "top" as const, rtMs: 700 })),
    },
    bisection: {
      lines,
      responses: lines.map((line) => ({ lineId: line.id, x: (line.x1 + line.x2) / 2 })),
    },
    normsUsed: {},
    ...overrides,
  });
}

function render(record: BatteryRecord): string {
  return renderToStaticMarkup(
    createElement(BatteryResults, { record, onExport() {}, onBack() {} }),
  );
}

describe("BatteryResults", () => {
  it("renders the verdict and a ledger row for each counted test", () => {
    const record = fixtureRecord();
    const display = batteryDisplay(record, false);
    const html = render(record);

    assert.match(html, new RegExp(display.evidence.verdict.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /in units of normal person-to-person variation; negative means the left side is weaker/);
    assert.match(html, /Screening aid, not a diagnosis/);
    assert.match(html, /do not enter the evidence model/);
    assert.match(html, /Uncalibrated/);
    assert.match(html, /Show patient example/);
    assert.match(html, /Export JSON/);

    const countedLabels = display.counted.map((row) => row.label);
    assert.deepEqual(
      countedLabels.map((label) => label.replace(/,.*/, "")).sort(),
      ["Line bisection"].sort(),
    );
    const ledgerLabels = display.ledger.map((row) => row.label.replace(/,.*/, "")).sort();
    assert.deepEqual(ledgerLabels, ["Clock check", "Greyscales", "Line bisection", "Scene search"].sort());
    for (const label of ledgerLabels) {
      assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.equal((html.match(/<tbody>/g) ?? []).length, 1);
    assert.equal((html.match(/<tr>/g) ?? []).length, 1 + display.ledger.length);
    assert.doesNotMatch(html, /hidden area included/);
  });

  it("swaps the scene reading for the induced result instead of adding a second reading", () => {
    const record = fixtureRecord();
    const off = batteryDisplay(record, false);
    const on = batteryDisplay(record, true);

    const sceneOff = off.evidence.tests.filter((row) => row.test === "scene");
    const sceneOn = on.evidence.tests.filter((row) => row.test === "scene");
    assert.equal(sceneOff.length, 1);
    assert.equal(sceneOn.length, 1);
    assert.equal(off.ledger.filter((row) => row.test === "scene").length, 1);
    assert.equal(on.ledger.filter((row) => row.test === "scene").length, 1);
    assert.equal(off.counted.filter((row) => row.test === "scene").length, 0);
    assert.equal(on.counted.filter((row) => row.test === "scene").length, 0);
    assert.equal(sceneOff[0]!.label, "Scene search");
    assert.equal(sceneOn[0]!.label, "Scene search, hidden area included");
    const offScene = off.observations.find((row) => row.test === "scene");
    const onScene = on.observations.find((row) => row.test === "scene");
    assert.ok(offScene && onScene);
    assert.notEqual(offScene.value, onScene.value);

    const otherOff = off.counted.filter((row) => row.test !== "scene").map((row) => row.test);
    const otherOn = on.counted.filter((row) => row.test !== "scene").map((row) => row.test);
    assert.deepEqual(otherOn, otherOff);
    assert.equal(off.evidence.tests.length, on.evidence.tests.length);
  });

  it("exports JSON that round-trips through parseBatteryRecord", () => {
    const record = fixtureRecord();
    const json = serializeBatteryRecord(record);
    const parsed = parseBatteryRecord(JSON.parse(json));
    assert.deepEqual(parsed, parseBatteryRecord(record));
    assert.equal(parsed.id, "battery-results-1");
    assert.equal(parsed.contract, BATTERY_CONTRACT_VERSION);
  });

  it("labels demonstration records", () => {
    const record = fixtureRecord({ mode: "demo", source: "demonstration", greyscales: null, bisection: null, readingDirection: null });
    const html = render(record);
    assert.match(html, /demonstration/i);
  });
});

describe("clinician PDF battery section", () => {
  it("includes the battery verdict when a record is provided", async () => {
    const record = fixtureRecord();
    const display = batteryDisplay(record, false);
    const blob = buildClinicianReportPdf({
      profileAlias: "Test P",
      sessions: [],
      selected: null,
      trend: { key: null, points: [], excluded: [] },
      notes: [],
      generatedAt: "2026-11-14T12:00:00.000Z",
      battery: record,
    });
    const text = await blob.text();
    assert.match(text, /Battery/);
    assert.match(text, /Screening aid, not a diagnosis/);
    assert.match(text, new RegExp(display.evidence.verdict.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
