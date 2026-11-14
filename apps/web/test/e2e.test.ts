import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ApiOfflineError,
  createAppServices,
  createMemoryKeyValueStore,
  showApiControls,
  shouldEnqueueUpload,
} from "../src/services/index.ts";
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

  it("signs in through API routes, queues an upload, polls processing, exports, deletes, and stays offline when standalone", async () => {
    const calls: string[] = [];
    const states = ["pending", "ready"];
    const kv = createMemoryKeyValueStore();

    const services = createAppServices({
      now: () => new Date("2026-11-14T17:00:00.000Z"),
      keyValueStore: kv,
      config: {
        apiBaseUrl: "https://api.example.test",
        standalone: false,
      },
      fetch: async (input, init) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("/api/v1/auth/callback")) {
          return new Response(null, { status: 302, headers: { location: "/" } });
        }
        if (url.endsWith("/api/v1/me") || url.endsWith("/api/v1/auth/local")) {
          return new Response(
            JSON.stringify({
              subject: "participant-demo",
              orgId: "org-demo",
              role: "participant",
              csrfToken: "csrf-e2e",
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        if (url.includes("/exports")) {
          return new Response(JSON.stringify({ exportId: "e2e-export", bundle: { sessions: [] } }), {
            status: 200,
          });
        }
        if ((init?.method ?? "GET") === "DELETE") {
          return new Response(
            JSON.stringify({ participantId: "e2e-part", deleted: true, idempotent: false }),
            { status: 200 },
          );
        }
        if (url.includes("/batches/") || url.endsWith("/finalize")) {
          return new Response(
            JSON.stringify({
              batchId: "e2e-live-batch-1",
              sequence: 1,
              idempotent: true,
              sessionId: "e2e-live",
              sealed: true,
              jobId: "job-e2e",
              inputHash: "hash",
              processing: "pending",
            }),
            { status: 200 },
          );
        }
        const processing = states.shift() ?? "ready";
        return new Response(
          JSON.stringify({
            id: "e2e-live",
            participantId: "e2e-part",
            assignmentId: "assign-1",
            assignmentRevision: 1,
            startedAt: "2026-11-14T17:00:00.000Z",
            completion: "complete",
            sync: "acknowledged",
            processing,
            sealed: true,
            sessionRevision: 1,
            inputHash: "hash",
            processingDetail: {
              state: processing,
              retryable: false,
              lastError: null,
              jobStatus: processing,
            },
          }),
          { status: 200 },
        );
      },
    });

    const redirect = await services.beginSignIn();
    assert.equal(redirect.url, "https://api.example.test/api/v1/auth/login");
    await services.completeSignIn("https://app.example.test/?code=e2e-code&state=e2e-state");
    const me = await services.getMe();
    assert.equal(me?.subject, "participant-demo");

    const live = services.completeSession(
      services.startSession({ id: "e2e-live", alias: "E2E live", startedAt: "2026-11-14T17:00:00.000Z" }),
      { completedAt: "2026-11-14T17:03:00.000Z" },
    );
    assert.equal(shouldEnqueueUpload({ ended: true, session: live, apiEnabled: services.apiEnabled }), true);
    await services.save(live);
    await services.enqueueUpload({ session: live });
    await services.drainQueue();
    assert.equal(services.queueState().acknowledged, 1);

    assert.deepEqual(await services.health(), { status: "ok" });
    const processed = await services.pollProcessingState("e2e-live", {
      sleep: async () => undefined,
    });
    assert.equal(processed.terminal, true);
    assert.equal(processed.processing, "ready");
    const exported = await services.exportParticipant("e2e-part");
    const deleted = await services.deleteParticipant("e2e-part");
    assert.equal(exported.exportId, "e2e-export");
    assert.equal(deleted.deleted, true);
    assert.ok(calls.some((call) => call.includes("/health")));
    assert.ok(calls.some((call) => call.includes("/api/v1/sessions/e2e-live")));
    assert.ok(calls.some((call) => call.includes("/exports")));
    assert.ok(calls.some((call) => call.startsWith("DELETE ")));
    assert.ok(showApiControls(services.apiEnabled));

    let standaloneCalls = 0;
    const standalone = createAppServices({
      standalone: true,
      fetch: async () => {
        standaloneCalls += 1;
        throw new Error("standalone must not call fetch");
      },
    });
    assert.equal(standalone.apiEnabled, false);
    assert.equal(standalone.storeKind, "memory");
    assert.equal(showApiControls(standalone.apiEnabled), false);
    await assert.rejects(() => standalone.pollProcessingState("e2e-live"), ApiOfflineError);
    await assert.rejects(() => standalone.exportParticipant("e2e-part"), ApiOfflineError);
    await assert.rejects(() => standalone.deleteParticipant("e2e-part"), ApiOfflineError);
    await assert.rejects(() => standalone.enqueueUpload({ session: live }), ApiOfflineError);
    assert.equal(standaloneCalls, 0);
  });
});
