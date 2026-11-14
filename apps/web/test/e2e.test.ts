import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAppServices } from "../src/services/index.ts";
import type { SessionRecord } from "@neurovision/domain";

function assessmentTargets(session: SessionRecord, leftHits: number, rightHits: number) {
  const trial = session.trials.find((item) => item.task === "target-selection");
  if (!trial) throw new Error("missing target-selection trial");
  const left = trial.layout.stimuli
    .filter((stimulus) => stimulus.kind === "target" && stimulus.side === "left")
    .slice(0, leftHits);
  const right = trial.layout.stimuli
    .filter((stimulus) => stimulus.kind === "target" && stimulus.side === "right")
    .slice(0, rightHits);
  return { trial, stimuli: [...left, ...right] };
}

describe("service-layer end-to-end flow", () => {
  it("loads demonstration data, then starts, scores, saves, reloads, compares, and reflects a live session", async () => {
    const services = createAppServices({
      now: () => new Date("2026-11-14T17:00:00.000Z"),
    });

    const demonstrations = services.loadDemonstrationSessions();
    assert.equal(demonstrations.length, 3);
    const demoKinds = demonstrations.map((session) => services.score(session).spatialPattern.kind);
    assert.deepEqual(demoKinds, ["balanced", "left-omission", "right-omission"]);
    const gaze = services.loadGazeLabData();
    assert.equal(gaze.streams.length, 2);
    await services.seedDemonstrationHistory();

    let live = services.startSession({
      id: "e2e-live",
      alias: "E2E live",
      startedAt: "2026-11-14T17:00:00.000Z",
    });
    assert.equal(live.status, "incomplete");
    const { trial, stimuli } = assessmentTargets(live, 6, 12);
    let elapsed = 800;
    for (const stimulus of stimuli) {
      live = services.recordClick(live, trial.id, { x: stimulus.x, y: stimulus.y }, elapsed);
      elapsed += 650;
    }
    live = services.finishTrial(live, trial.id, "done", 22_000);
    for (const lineTrial of live.trials.filter((item) => item.task === "line-bisection")) {
      assert.ok(lineTrial.line);
      const midpoint = (lineTrial.line.x1 + lineTrial.line.x2) / 2;
      live = services.recordClick(live, lineTrial.id, { x: midpoint, y: lineTrial.line.y }, 1200);
      live = services.finishTrial(live, lineTrial.id, "done", 2400);
    }
    live = services.completeSession(live, { completedAt: "2026-11-14T17:03:00.000Z" });

    const scored = services.score(live);
    assert.equal(scored.spatialPattern.kind, "left-omission");
    assert.equal(scored.practice.cue, "left");
    assert.equal(live.decision.cue, "left");

    const saved = await services.save(live);
    const reloaded = await services.load("e2e-live");
    assert.ok(reloaded);
    assert.deepEqual(reloaded, saved);
    assert.equal(services.score(reloaded).spatialPattern.kind, "left-omission");

    const second = services.completeSession(
      (() => {
        let session = services.startSession({
          id: "e2e-live-2",
          alias: "E2E live 2",
          startedAt: "2026-11-14T17:10:00.000Z",
        });
        const filled = assessmentTargets(session, 10, 10);
        let clock = 800;
        for (const stimulus of filled.stimuli) {
          session = services.recordClick(session, filled.trial.id, { x: stimulus.x, y: stimulus.y }, clock);
          clock += 650;
        }
        session = services.finishTrial(session, filled.trial.id, "done", 22_000);
        for (const lineTrial of session.trials.filter((item) => item.task === "line-bisection")) {
          assert.ok(lineTrial.line);
          const midpoint = (lineTrial.line.x1 + lineTrial.line.x2) / 2;
          session = services.recordClick(session, lineTrial.id, { x: midpoint, y: lineTrial.line.y }, 1200);
          session = services.finishTrial(session, lineTrial.id, "done", 2400);
        }
        return session;
      })(),
      { completedAt: "2026-11-14T17:13:00.000Z" },
    );
    await services.save(second);

    assert.equal(services.sessionsComparable(reloaded, second), true);
    const history = await services.comparableHistory();
    assert.deepEqual(
      history.trend.points.map((point) => point.sessionId),
      ["e2e-live", "e2e-live-2"],
    );
    assert.equal(
      history.trend.excluded.some((item) => item.sessionId === demonstrations[0]?.id && item.reason === "demonstration"),
      true,
    );

    const { trial: practiceTrial, setup } = services.startPracticeTrial(reloaded, {
      cue: scored.practice.cue,
      density: scored.practice.density,
    });
    assert.equal(setup.config.cue, "left");
    let practice = practiceTrial;
    let practiceElapsed = 500;
    const practiceTargets = practice.layout.stimuli.filter((stimulus) => stimulus.kind === "target");
    for (const stimulus of practiceTargets) {
      practice = services.recordTrialClick(practice, reloaded.id, { x: stimulus.x, y: stimulus.y }, practiceElapsed);
      practiceElapsed += 400;
    }
    practice = services.finishStandaloneTrial(practice, "done", 12_000);
    const reflection = services.reflectPractice(practice, scored.targetSelection);
    assert.ok(reflection.versusAssessment);
    assert.equal(reflection.versusAssessment.assessmentPattern, "left-omission");
    assert.equal(reflection.orderedHits.length, practiceTargets.length);
    const withPractice = services.appendPracticeRound(reloaded, practice, setup.config);
    const savedPractice = await services.save(withPractice);
    const reloadedPractice = await services.load("e2e-live");
    assert.ok(reloadedPractice);
    assert.equal(reloadedPractice.practice.length, 1);
    assert.equal(savedPractice.practice[0]?.config.cue, "left");
    const trendAfterPractice = await services.comparableHistory();
    assert.equal(
      trendAfterPractice.trend.points.some((point) => point.sessionId === "e2e-live"),
      true,
    );
  });
});
