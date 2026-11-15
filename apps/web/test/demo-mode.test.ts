import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  STARRY_DEFAULTS,
  classifyResponse,
  generateStarryTrials,
  isHealthyControlSample,
  lineLength,
  lineMidpoint,
  scoringNormsFromBatteries,
  summarizeAssessmentTrend,
  type SessionRecord,
  type TrialEndReason,
  type TrialRecord,
  type Viewport,
} from "@neurovision/domain";
import { DemoModeToggle } from "../src/components/DemoModeToggle.tsx";
import { assembleAssessmentBatteryRecord, shouldPersistBattery } from "../src/data/batterySession.ts";
import { DEMO_MODE_STORAGE_KEY, readDemoMode, writeDemoMode } from "../src/lib/demo-mode.ts";
import {
  createSession,
  newLineTrial,
  newTargetSelectionTrial,
  recordAssessmentTrial,
} from "../src/lib/session.ts";
import { shouldEnqueueUpload, shouldPersistSession } from "../src/services/screen-wiring.ts";

const VP: Viewport = { width: 1280, height: 900, dpr: 1, class: "desktop-960" };

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

function clickTargets(trial: TrialRecord, session: SessionRecord, end: TrialEndReason = "done"): TrialRecord {
  const events = [] as TrialRecord["events"];
  trial.layout.stimuli
    .filter((item) => item.kind === "target")
    .forEach((item, index) => {
      events.push(
        classifyResponse({
          sessionId: session.id,
          trialId: trial.id,
          task: trial.task,
          layout: trial.layout,
          existing: events,
          point: item,
          elapsed: 400 + index * 200,
        }),
      );
    });
  return { ...trial, events, duration: 8_000, end };
}

function markLine(trial: TrialRecord, session: SessionRecord): TrialRecord {
  const line = trial.line!;
  const event = classifyResponse({
    sessionId: session.id,
    trialId: trial.id,
    task: trial.task,
    layout: trial.layout,
    line,
    existing: [],
    point: { x: lineMidpoint(line), y: line.y },
    elapsed: 500,
  });
  return { ...trial, events: [event], duration: 1_500, end: "done" };
}

function demoSession(): SessionRecord {
  return createSession({
    alias: "Demo",
    input: "mouse-trackpad",
    viewport: VP,
    source: "demonstration",
    now: new Date("2026-11-15T10:00:00.000Z"),
    id: "demo-run-1",
  });
}

describe("Demo mode toggle persistence", () => {
  it("defaults to off and round-trips through sessionStorage", () => {
    const storage = memoryStorage();
    assert.equal(readDemoMode(storage), false);
    assert.equal(writeDemoMode(true, storage), true);
    assert.equal(storage.getItem(DEMO_MODE_STORAGE_KEY), "on");
    assert.equal(readDemoMode(storage), true);
    assert.equal(writeDemoMode(false, storage), false);
    assert.equal(storage.getItem(DEMO_MODE_STORAGE_KEY), null);
    assert.equal(readDemoMode(storage), false);
  });

  it("treats any value other than on as off", () => {
    const storage = memoryStorage();
    storage.setItem(DEMO_MODE_STORAGE_KEY, "true");
    assert.equal(readDemoMode(storage), false);
  });

  it("renders a highlighted pill when on and a ghost control when off", () => {
    const on = renderToStaticMarkup(
      createElement(DemoModeToggle, { on: true, onToggle() {} }),
    );
    const off = renderToStaticMarkup(
      createElement(DemoModeToggle, { on: false, onToggle() {} }),
    );
    assert.match(on, /aria-pressed="true"/);
    assert.match(on, /class="demo-toggle on"/);
    assert.match(on, />Demo mode</);
    assert.match(off, /aria-pressed="false"/);
    assert.match(off, /class="ghost demo-toggle"/);
    assert.doesNotMatch(off, /demo-toggle on/);
  });
});

describe("Demo mode shortened configs", () => {
  it("shortens Starry Night to 5 targets split 2/3", () => {
    assert.equal(STARRY_DEFAULTS.demoTargets, 5);
    assert.equal(STARRY_DEFAULTS.fullTargets, 15);
    const extras = new Set<number>();
    for (const seed of [3, 8, 11, 21, 34]) {
      const trials = generateStarryTrials(STARRY_DEFAULTS.demoTargets, seed);
      assert.equal(trials.length, 5);
      extras.add(trials.filter((item) => item.side === "left").length);
    }
    assert.deepEqual([...extras].sort(), [2, 3]);
  });

  it("keeps 48 hollow-ring items and leaves 4 targets, two per side", () => {
    const session = demoSession();
    const full = newTargetSelectionTrial(session, "fixed-a", VP);
    const demo = newTargetSelectionTrial(session, "fixed-a", VP, true);
    assert.equal(full.layout.stimuli.length, 48);
    assert.equal(full.layout.stimuli.filter((item) => item.kind === "target").length, 24);
    assert.equal(demo.layout.stimuli.length, 48);
    assert.equal(demo.layout.stimuli.filter((item) => item.kind === "target").length, 4);
    assert.equal(demo.layout.stimuli.filter((item) => item.kind === "target" && item.side === "left").length, 2);
    assert.equal(demo.layout.stimuli.filter((item) => item.kind === "target" && item.side === "right").length, 2);
    assert.deepEqual(
      demo.layout.stimuli.map(({ id, x, y, side }) => ({ id, x, y, side })),
      full.layout.stimuli.map(({ id, x, y, side }) => ({ id, x, y, side })),
    );
  });

  it("uses two existing line lengths and finishes after the second mark", () => {
    const session = demoSession();
    const first = newLineTrial(session, 0, VP, true);
    const second = newLineTrial(session, 1, VP, true);
    assert.deepEqual([lineLength(first.line!), lineLength(second.line!)], [400, 700]);
    assert.throws(() => newLineTrial(session, 2, VP, true), /out of range/);

    let current = recordAssessmentTrial(session, clickTargets(newTargetSelectionTrial(session, "fixed-a", VP, true), session), new Date(), {
      demo: true,
    }).session;
    const afterFirst = recordAssessmentTrial(current, markLine(newLineTrial(current, 0, VP, true), current), new Date(), { demo: true });
    assert.equal(afterFirst.finished, false);
    const afterSecond = recordAssessmentTrial(
      afterFirst.session,
      markLine(newLineTrial(afterFirst.session, 1, VP, true), afterFirst.session),
      new Date(),
      { demo: true },
    );
    assert.equal(afterSecond.finished, true);
    assert.equal(afterSecond.session.status, "complete");
    assert.equal(afterSecond.session.trials.filter((trial) => trial.task === "line-bisection").length, 2);
  });
});

describe("Demo run exclusion", () => {
  it("tags a demo assessment as demonstration and keeps it out of storage, trends, and fitting", () => {
    const started = demoSession();
    const rings = recordAssessmentTrial(
      started,
      clickTargets(newTargetSelectionTrial(started, "fixed-a", VP, true), started),
      new Date("2026-11-15T10:01:00.000Z"),
      { demo: true },
    ).session;
    const firstLine = recordAssessmentTrial(
      rings,
      markLine(newLineTrial(rings, 0, VP, true), rings),
      new Date("2026-11-15T10:02:00.000Z"),
      { demo: true },
    ).session;
    const finished = recordAssessmentTrial(
      firstLine,
      markLine(newLineTrial(firstLine, 1, VP, true), firstLine),
      new Date("2026-11-15T10:03:00.000Z"),
      { demo: true },
    ).session;

    assert.equal(finished.source, "demonstration");
    assert.equal(shouldPersistSession(finished), false);
    assert.equal(shouldEnqueueUpload({ ended: true, session: finished, apiEnabled: true }), false);

    const starry = generateStarryTrials(STARRY_DEFAULTS.demoTargets, 21);
    const battery = assembleAssessmentBatteryRecord(finished, {
      trials: starry,
      responses: starry.map((item) => ({ trialId: item.id, rtMs: 400 })),
    });
    assert.equal(battery.mode, "demo");
    assert.equal(battery.source, "demonstration");
    assert.equal(battery.healthyControl, false);
    assert.equal(shouldPersistBattery(battery), false);
    assert.equal(isHealthyControlSample(battery), false);
    assert.equal(scoringNormsFromBatteries([battery]).n, 0);
    assert.equal(summarizeAssessmentTrend([finished]).points.length, 0);
    assert.equal(summarizeAssessmentTrend([finished]).excluded[0]?.reason, "demonstration");
  });
});
