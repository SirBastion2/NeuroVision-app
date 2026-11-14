import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  classifyResponse,
  isSessionRecord,
  lineMidpoint,
  scoreSession,
  summarizeAssessmentTrend,
  type SessionRecord,
  type TrialEndReason,
  type TrialRecord,
  type Viewport,
} from "@neurovision/domain";
import { createLocalSessionStore } from "../src/data/sessionStore.ts";
import { flowReducer, initialFlow } from "../src/lib/flow.ts";
import {
  createSession,
  newLineTrial,
  newTargetSelectionTrial,
  profileIdFor,
  recordAssessmentTrial,
  sessionAliasForParticipant,
} from "../src/lib/session.ts";

const VP: Viewport = { width: 1280, height: 900, dpr: 1, class: "desktop-960" };
const fresh = (id = "s1", at = "2026-11-14T10:00:00Z") =>
  createSession({ alias: "Test P", input: "mouse-trackpad", viewport: VP, now: new Date(at), id });

function clickAll(trial: TrialRecord, ids: string[], session: SessionRecord, end: TrialEndReason = "done"): TrialRecord {
  const events = [] as TrialRecord["events"];
  ids.forEach((id, i) => {
    const s = trial.layout.stimuli.find((x) => x.id === id)!;
    events.push(
      classifyResponse({ sessionId: session.id, trialId: trial.id, task: trial.task, layout: trial.layout, existing: events, point: s, elapsed: 500 + i * 400 }),
    );
  });
  return { ...trial, events, duration: 10_000, end };
}

function markLine(trial: TrialRecord, session: SessionRecord, offset = 0): TrialRecord {
  const line = trial.line!;
  const e = classifyResponse({ sessionId: session.id, trialId: trial.id, task: trial.task, layout: trial.layout, line, existing: [], point: { x: lineMidpoint(line) + offset, y: line.y }, elapsed: 1500 });
  return { ...trial, events: [e], duration: 2000, end: "done" };
}

function fullSession(left: number, right: number, id = "s1", at = "2026-11-14T10:00:00Z"): SessionRecord {
  let s = fresh(id, at);
  const ts = newTargetSelectionTrial(s, "fixed-a", VP);
  const pick = (side: string, n: number) => ts.layout.stimuli.filter((x) => x.kind === "target" && x.side === side).slice(0, n).map((x) => x.id);
  s = recordAssessmentTrial(s, clickAll(ts, [...pick("left", left), ...pick("right", right)], s), new Date(at)).session;
  for (let i = 0; i < 5; i++) s = recordAssessmentTrial(s, markLine(newLineTrial(s, i, VP), s, 10), new Date(at)).session;
  return s;
}

describe("session building", () => {
  test("new sessions satisfy the domain contract", () => {
    assert.equal(isSessionRecord(fresh()), true);
    assert.equal(profileIdFor("  Demo A! "), "demo-a");
    assert.equal(profileIdFor(""), "anonymous");
    assert.equal(sessionAliasForParticipant(null), "");
    assert.equal(sessionAliasForParticipant("P-014"), "P-014");
    const unnamed = createSession({ alias: "", input: "mouse-trackpad", viewport: VP });
    assert.equal(unnamed.alias, "Anonymous");
    assert.equal(unnamed.profileId, "anonymous");
  });

  test("a full run completes after five lines and carries the domain practice suggestion", () => {
    const s = fullSession(4, 12);
    assert.equal(s.status, "complete");
    assert.equal(s.trials.length, 6);
    assert.equal(isSessionRecord(s), true);
    assert.deepEqual(s.decision, scoreSession(s).practice);
    assert.equal(s.decision.cue, "left");
  });

  test("an interruption ends the session as incomplete and keeps it out of the trend", () => {
    const s = fresh();
    const r = recordAssessmentTrial(s, { ...newTargetSelectionTrial(s, "fixed-a", VP), end: "hidden" });
    assert.equal(r.finished, true);
    assert.equal(r.session.status, "incomplete");
    assert.equal(isSessionRecord(r.session), true);
    assert.equal(summarizeAssessmentTrend([r.session]).points.length, 0);
  });
});

describe("flow", () => {
  test("walks intro → target → lines → review", () => {
    let st = flowReducer(initialFlow, { type: "start", session: fresh() });
    assert.equal(st.screen, "target-intro");
    assert.equal(st.variant, "fixed-a");
    st = flowReducer(st, { type: "trial-finished", trial: { ...newTargetSelectionTrial(st.session!, "fixed-a", VP), end: "done" } });
    assert.equal(st.screen, "line-intro");
    for (let i = 0; i < 5; i++) {
      assert.equal(st.lineIndex, i);
      st = flowReducer(st, { type: "trial-finished", trial: markLine(newLineTrial(st.session!, i, VP), st.session!) });
    }
    assert.equal(st.screen, "review");
    assert.equal(st.session!.status, "complete");
  });

  test("my-profile and profile screens redirect to history", () => {
    assert.equal(flowReducer(initialFlow, { type: "go", screen: "my-profile" }).screen, "history");
    assert.equal(flowReducer(initialFlow, { type: "go", screen: "profile" }).screen, "history");
  });

  test("old practice screens redirect to review when a session is open, otherwise home", () => {
    assert.equal(flowReducer(initialFlow, { type: "go", screen: "practice-setup" }).screen, "home");
    assert.equal(flowReducer(initialFlow, { type: "go", screen: "practice-task" }).screen, "home");
    assert.equal(flowReducer(initialFlow, { type: "go", screen: "practice-reflection" }).screen, "home");
    let st = flowReducer(initialFlow, { type: "open", session: fresh() });
    assert.equal(st.screen, "review");
    st = flowReducer(st, { type: "go", screen: "practice-setup" });
    assert.equal(st.screen, "review");
    st = flowReducer(st, { type: "go", screen: "practice-task" });
    assert.equal(st.screen, "review");
    st = flowReducer(st, { type: "go", screen: "practice-reflection" });
    assert.equal(st.screen, "review");
  });
});

describe("history", () => {
  test("live sessions form the trend; demonstrations never do", () => {
    const a = fullSession(6, 12, "a", "2026-11-01T10:00:00Z");
    const b = fullSession(10, 12, "b", "2026-11-08T10:00:00Z");
    const demo = { ...fullSession(10, 10, "demo-1", "2026-11-04T10:00:00Z"), source: "demonstration" as const };
    const trend = summarizeAssessmentTrend([b, a, demo]);
    assert.deepEqual(trend.points.map((p) => p.sessionId), ["a", "b"]);
    assert.equal(trend.excluded.filter((e) => e.reason === "demonstration").length, 1);
  });
});

describe("session store", () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      map,
    };
  }

  test("saves only valid records, upserts by id, and copies malformed records aside on import", async () => {
    const mem = memoryStorage();
    const store = createLocalSessionStore({ storage: mem });
    const s = fullSession(8, 8);
    assert.equal((await store.save(s)).ok, true);
    assert.equal((await store.save({ ...s, alias: "Renamed" })).ok, true);
    assert.equal((await store.load()).sessions[0]!.alias, "Renamed");
    assert.equal((await store.save({ ...s, source: "nope" } as unknown as SessionRecord)).ok, false);
    await store.save({ ...s, id: "s2" });
    assert.equal((await store.remove("s2")).ok, true);
    assert.equal((await store.load()).sessions.length, 1);
  });

  test("a malformed envelope is reported and left untouched", async () => {
    const mem = memoryStorage();
    mem.setItem("spatial-patterns:envelope:v1", "{");
    const store = createLocalSessionStore({ storage: mem });
    const loaded = await store.load();
    assert.match(loaded.error ?? "", /malformed|preserved/i);
    assert.equal((await store.save(fullSession(1, 1))).ok, false);
    assert.equal(mem.map.get("spatial-patterns:envelope:v1"), "{");
  });
});
